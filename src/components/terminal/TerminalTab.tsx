import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { copyToClipboard, readFromClipboard as pasteFromClipboard } from '../../utils/clipboard';
import { css, cx } from '@emotion/css';
import { Copy, Check, Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import {
  DEFAULT_TERMINAL_CONFIG,
  buildCombo,
  resolveTerminalKey,
  kittyEncodeKey,
  attachKittyProtocol,
} from '../../utils/terminalThemes';
import { writePtyChunked } from '../../utils/ptyUtils';
import { QuickActionsBar } from './QuickActionsBar';
import { interpolatePromptTemplate } from '../../utils/promptTemplate';
import { buildPromptContext, formatTerminalWrite } from '../../utils/quickActionInject';
import type { QuickAction } from '../../types';

// ── Public ref handle exposed to TerminalContainer ─────────────────────────
export interface TerminalTabHandle {
  /** Re-fit the terminal to its container (call after tab becomes visible). */
  fit: () => void;
  /** Focus the xterm instance so keyboard input is captured. */
  focus: () => void;
  /** Synchronously flush any pending buffered output to xterm. */
  flush: () => void;
}

interface TerminalTabProps {
  sessionId: string;
  workspacePath: string;
  /** Shell executable (e.g. "powershell", "wsl"). */
  shell: string;
  /** Optional extra args forwarded to spawn_pty (e.g. ["--", "bash"] for wsl). */
  shellArgs?: string[];
  /** Called when the PTY child process exits. */
  onExit?: () => void;
  /** Called when the shell emits OSC 0 or OSC 2 window/tab title changes. */
  onTitleChange?: (title: string) => void;
  /** Called when the shell emits OSC 7 or OSC 9 CWD changes. */
  onCwdChange?: (cwd: string) => void;
  /**
   * Whether this tab is actually on-screen right now (its workspace console
   * is showing AND it's the active/split-visible tab within it). The xterm
   * instance itself stays mounted regardless — this only gates the WebGL
   * renderer, see the "GPU renderer" effect below.
   */
  isVisible?: boolean;
}

type SpawnState = 'idle' | 'spawning' | 'running' | 'error';

// ── Propose safe dimensions helper ──────────────────────────────────────────
// Always probe proposeDimensions() before resizing. If the container has
// zero size, proposeDimensions() returns undefined.
function proposeSafeDimensions(addon: FitAddon): { cols: number; rows: number } | null {
  try {
    const dims = addon.proposeDimensions();
    if (!dims || dims.cols <= 0 || dims.rows <= 0) return null;
    return {
      cols: Math.max(10, dims.cols),
      rows: Math.max(1, dims.rows),
    };
  } catch {
    return null;
  }
}

export const TerminalTab = forwardRef<TerminalTabHandle, TerminalTabProps>(
  (
    {
      sessionId,
      workspacePath,
      shell,
      shellArgs,
      onExit,
      onTitleChange,
      onCwdChange,
      isVisible = true,
    },
    ref
  ) => {
    const { settings, workspaces, spaces, activeWorkspaceId, activeSpaceId } = useDashboard();
    const terminalConfig = useMemo(
      () => settings.terminalConfig ?? DEFAULT_TERMINAL_CONFIG,
      [settings.terminalConfig]
    );

    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const webglAddonRef = useRef<WebglAddon | null>(null);
    const [spawnState, setSpawnState] = useState<SpawnState>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [hasSelection, setHasSelection] = useState(false);
    const [hasCopied, setHasCopied] = useState(false);

    // Search state & options
    const [searchVisible, setSearchVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
    const [searchWholeWord, setSearchWholeWord] = useState(false);
    const [searchRegex, setSearchRegex] = useState(false);
    const [searchResults, setSearchResults] = useState<{ index: number; count: number } | null>(
      null
    );

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    // Visual bell state
    const [bellActive, setBellActive] = useState(false);

    // Search addon ref
    const searchAddonRef = useRef<SearchAddon | null>(null);

    // Live search options — read by executeSearch so option toggles take
    // effect immediately instead of racing React's re-render through a
    // setTimeout closure that captured the previous option state.
    const searchOptionsRef = useRef({ caseSensitive: false, wholeWord: false, regex: false });

    // Guards & tracking refs
    const effectActiveRef = useRef(false);
    const isSpawnedRef = useRef(false);
    const lastPtyColsRowsRef = useRef<{ cols: number; rows: number } | null>(null);
    const requestResizeRef = useRef<
      ((cols: number, rows: number, immediate?: boolean) => void) | null
    >(null);

    // Live refs to avoid stale closures in listeners
    const keybindingsRef = useRef(terminalConfig.keybindings);
    keybindingsRef.current = terminalConfig.keybindings;
    const onExitRef = useRef(onExit);
    onExitRef.current = onExit;
    const onTitleChangeRef = useRef(onTitleChange);
    onTitleChangeRef.current = onTitleChange;
    const onCwdChangeRef = useRef(onCwdChange);
    onCwdChangeRef.current = onCwdChange;
    const searchVisibleRef = useRef(searchVisible);
    searchVisibleRef.current = searchVisible;
    const contextMenuRef = useRef(contextMenu);
    contextMenuRef.current = contextMenu;

    // ── Deduplicated paste helper to prevent duplicate pasting ─────────────
    const lastPasteTimeRef = useRef(0);
    const lastPasteTextRef = useRef('');
    const safePaste = useCallback((text: string) => {
      const term = termRef.current;
      if (!term || !text) return;
      const now = Date.now();
      if (text === lastPasteTextRef.current && now - lastPasteTimeRef.current < 250) {
        return; // Suppress duplicate paste fired in same burst
      }
      lastPasteTimeRef.current = now;
      lastPasteTextRef.current = text;
      term.paste(text);
    }, []);

    // ── High-throughput data bufferer (VS Code TerminalDataBufferer pattern) ──
    // Batches rapid incoming PTY chunks to prevent UI thread micro-stutters.
    // The raw byte stream is never mutated so xterm and ConPTY coordinates remain in 100% sync.
    const writeBufferRef = useRef<string[]>([]);
    const writeRafRef = useRef<number | null>(null);

    const flushWrites = useCallback(() => {
      if (writeRafRef.current !== null) {
        cancelAnimationFrame(writeRafRef.current);
        writeRafRef.current = null;
      }
      const term = termRef.current;
      if (!term || writeBufferRef.current.length === 0) return;

      const raw = writeBufferRef.current.join('');
      writeBufferRef.current = [];
      term.write(raw);
    }, []);

    // ── Expose imperative handle to parent ──────────────────────────────────
    useImperativeHandle(ref, () => ({
      fit: () => {
        const term = termRef.current;
        const fitAddon = fitAddonRef.current;
        if (!fitAddon || !term) return;
        flushWrites();
        (term as any)._core?._charSizeService?.measure();
        const dims = proposeSafeDimensions(fitAddon);
        if (dims) {
          requestResizeRef.current?.(dims.cols, dims.rows, true);
        }
        try {
          webglAddonRef.current?.clearTextureAtlas();
        } catch {
          /* DOM renderer */
        }
        term.scrollToBottom();
        term.refresh(0, term.rows - 1);
      },
      focus: () => {
        termRef.current?.focus();
      },
      flush: () => {
        flushWrites();
      },
    }));

    // ── Quick Actions bar → PTY ───────────────────────────────────────────
    const runQuickActionCommand = useCallback(
      (command: string, autoExecute: boolean) => {
        const term = termRef.current;
        if (!term) return;
        flushWrites();
        const data = formatTerminalWrite(command, autoExecute, term.modes.bracketedPasteMode);
        writePtyChunked(sessionId, data).catch((err) =>
          console.error('[TerminalTab] write_pty failed:', err)
        );
      },
      [sessionId, flushWrites]
    );

    const handleRunAction = useCallback(
      (action: QuickAction) => {
        const ctx = buildPromptContext(termRef.current, {
          workspaces,
          spaces,
          activeWorkspaceId,
          activeSpaceId,
          fallbackWorkspacePath: workspacePath,
        });
        const text = interpolatePromptTemplate(action.command, ctx);
        runQuickActionCommand(text, action.autoExecute);
      },
      [workspaces, spaces, activeWorkspaceId, activeSpaceId, workspacePath, runQuickActionCommand]
    );

    // ── Spawn helper ─────────────────────────────────────────────────────────
    const spawnInFlightRef = useRef(false);
    const spawnSession = useCallback(async () => {
      const term = termRef.current;
      if (!term || spawnInFlightRef.current) return;

      spawnInFlightRef.current = true;
      setSpawnState('spawning');
      setErrorMsg('');

      const dims = fitAddonRef.current ? proposeSafeDimensions(fitAddonRef.current) : null;
      const cols = dims?.cols ?? term.cols;
      const rows = dims?.rows ?? term.rows;

      term.resize(cols, rows);

      try {
        await invoke('spawn_pty', {
          sessionId,
          workspacePath,
          cols,
          rows,
          shell,
          shellArgs: shellArgs ?? [],
        });

        isSpawnedRef.current = true;
        setSpawnState('running');
        lastPtyColsRowsRef.current = { cols, rows };

        termRef.current?.focus();
      } catch (err: any) {
        const msg = typeof err === 'string' ? err : (err?.message ?? 'Unknown error');
        setSpawnState('error');
        setErrorMsg(msg);
        term.write(`\r\n\x1b[31m[Error] Failed to spawn shell: ${msg}\x1b[0m\r\n`);
      } finally {
        spawnInFlightRef.current = false;
      }
    }, [sessionId, workspacePath, shell, shellArgs]);

    // ── Search executor helper ───────────────────────────────────────────────
    const executeSearch = useCallback((query: string, forward = true) => {
      const addon = searchAddonRef.current;
      if (!addon) return;
      if (!query) {
        addon.clearDecorations();
        setSearchResults(null);
        return;
      }

      const { caseSensitive, wholeWord, regex } = searchOptionsRef.current;
      const options = {
        caseSensitive,
        wholeWord,
        regex,
        decorations: {
          matchOverviewRuler: '#565d61',
          activeMatchColorOverviewRuler: '#2f8f7a',
        },
      };

      if (forward) {
        addon.findNext(query, options);
      } else {
        addon.findPrevious(query, options);
      }

      if (!(addon as any).onDidChangeResults) {
        setSearchResults({ index: 1, count: 1 });
      }
    }, []);

    // ── Main effect — creates xterm, wires listeners, spawns PTY ─────────
    useEffect(() => {
      if (!containerRef.current) return;
      if (effectActiveRef.current) return;
      effectActiveRef.current = true;
      writeBufferRef.current = [];

      // ─ xterm instance (matches VS Code xterm configuration) ───────────
      const term = new Terminal({
        cursorBlink: terminalConfig.cursorBlink,
        cursorStyle: terminalConfig.cursorStyle,
        scrollback: terminalConfig.scrollback,
        macOptionIsMeta: terminalConfig.macOptionIsMeta,
        macOptionClickForcesSelection: false,
        theme: terminalConfig.theme,
        fontFamily: terminalConfig.fontFamily,
        fontSize: terminalConfig.fontSize,
        lineHeight: terminalConfig.lineHeight,
        letterSpacing: Number.isFinite(terminalConfig.letterSpacing)
          ? terminalConfig.letterSpacing
          : 0,
        allowProposedApi: true,
        rescaleOverlappingGlyphs: true,
        scrollOnEraseInDisplay: true,
        reflowCursorLine: false,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      const webLinksAddon = new WebLinksAddon((_e, uri) => {
        openUrl(uri).catch((err: any) => {
          console.error('[TerminalTab] Failed to open link:', err);
        });
      });
      term.loadAddon(webLinksAddon);

      const searchAddon = new SearchAddon();
      term.loadAddon(searchAddon);
      searchAddonRef.current = searchAddon;

      // Listen to search result updates if supported by the search addon
      if ((searchAddon as any).onDidChangeResults) {
        (searchAddon as any).onDidChangeResults(
          (e: { resultIndex: number; resultCount: number }) => {
            if (e.resultCount === 0) {
              setSearchResults({ index: 0, count: 0 });
            } else {
              setSearchResults({ index: e.resultIndex + 1, count: e.resultCount });
            }
          }
        );
      }

      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = '11';

      term.open(containerRef.current);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // ─ Mouse shortcuts ──────────────────────────────────────────────────
      const onMouseUp = (e: MouseEvent) => {
        if (e.button === 1) {
          e.preventDefault();
          const selection = term.getSelection();
          if (selection) {
            safePaste(selection);
          } else {
            pasteFromClipboard()
              .then((text) => {
                if (text) safePaste(text);
              })
              .catch(() => {});
          }
        }
      };
      const onMouseDown = (e: MouseEvent) => {
        if (e.button === 1) e.preventDefault();
      };

      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      };

      term.element?.addEventListener('mouseup', onMouseUp);
      term.element?.addEventListener('mousedown', onMouseDown);
      term.element?.addEventListener('contextmenu', onContextMenu);

      const selDispose = term.onSelectionChange(() => {
        setHasSelection(term.hasSelection());
      });

      const bellDispose = term.onBell(() => {
        setBellActive(true);
        setTimeout(() => setBellActive(false), 200);
      });

      // ─ Forward keyboard input → PTY ──────────────────────────────────
      const dataDispose = term.onData((data) => {
        flushWrites();
        if (data.length > 80) {
          // Large bursts (pastes) are chunked for ConPTY/readline tolerance,
          // but at 1024 chars per chunk — the old 80-char default turned a
          // 1MB paste into ~2 minutes of writes. Escape/surrogate-aware
          // splitting in writePtyChunked keeps sequences intact.
          writePtyChunked(sessionId, data, 1024, 8).catch((err) =>
            console.error('[TerminalTab] writePtyChunked failed:', err)
          );
        } else {
          invoke('write_pty', { sessionId, data }).catch((err) =>
            console.error('[TerminalTab] write_pty failed:', err)
          );
        }
      });

      // ─ Kitty keyboard protocol ────────────────────────────────────────────
      const kitty = attachKittyProtocol(term, (data) => {
        invoke('write_pty', { sessionId, data }).catch(() => {});
      });

      // ─ Single keyboard authority ──────────────────────────────────────────
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.type !== 'keydown') return true;

        // IME (CJK etc.) composition keys must reach xterm's composition
        // machinery untouched, or half-typed characters get dropped.
        if ((e as KeyboardEvent & { isComposing?: boolean }).isComposing) return true;

        // When search is open, Escape closes search and refocuses terminal
        if (searchVisibleRef.current) {
          if (e.key === 'Escape') {
            setSearchVisible(false);
            searchAddonRef.current?.clearDecorations();
            setSearchQuery('');
            setSearchResults(null);
            term.focus();
            return false;
          }
          return false;
        }

        // Escape closes context menu
        if (e.key === 'Escape' && contextMenuRef.current) {
          setContextMenu(null);
          return false;
        }

        // ─ User-configured keybindings take precedence over every built-in ──
        // intercept below. Without this, a combo like ctrl+f or ctrl+shift+v
        // could never be rebound (send-text, passthrough, …) because the
        // hardcoded handler swallowed it first.
        const binding = resolveTerminalKey(buildCombo(e), keybindingsRef.current);
        if (binding) {
          if (binding.action === 'passthrough') {
            // Explicit passthrough: skip built-ins, optionally kitty-encode.
            const kittySeq = kittyEncodeKey(e, kitty.getFlags());
            if (kittySeq) {
              e.preventDefault?.();
              invoke('write_pty', { sessionId, data: kittySeq }).catch(() => {});
              return false;
            }
            return true;
          }
          e.preventDefault?.();
          switch (binding.action) {
            case 'clear':
              term.clear();
              break;
            case 'scroll-top':
              term.scrollToTop();
              break;
            case 'scroll-bottom':
              term.scrollToBottom();
              break;
            case 'send-text':
              invoke('write_pty', { sessionId, data: binding.text ?? '' }).catch(() => {});
              break;
            case 'copy':
              if (term.hasSelection()) {
                copyToClipboard(term.getSelection()).catch(() => {});
              }
              break;
            case 'paste':
              pasteFromClipboard().then((text) => {
                if (text) safePaste(text);
              });
              break;
          }
          return false;
        }

        // macOS Cmd+C for copy / Cmd+V for paste
        const isMac =
          typeof navigator !== 'undefined' &&
          /(Macintosh|MacIntel|MacPPC|Mac68K|iPad|iPhone|iPod)/i.test(navigator.userAgent || '');
        if (isMac && e.metaKey && !e.ctrlKey && !e.altKey) {
          if (e.key.toLowerCase() === 'c' && !e.shiftKey) {
            e.preventDefault?.();
            if (term.hasSelection()) {
              copyToClipboard(term.getSelection());
            }
            return false;
          }
          if (e.key.toLowerCase() === 'v' && !e.shiftKey) {
            e.preventDefault?.();
            pasteFromClipboard().then((text) => {
              if (text) safePaste(text);
            });
            return false;
          }
        }

        // Standard terminal Ctrl+Shift+C / Ctrl+Insert for copy
        if (
          (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') ||
          (e.ctrlKey && e.key === 'Insert')
        ) {
          e.preventDefault?.();
          if (term.hasSelection()) {
            copyToClipboard(term.getSelection());
          }
          return false;
        }

        // Standard terminal Ctrl+Shift+V / Shift+Insert for paste
        if (
          (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') ||
          (e.shiftKey && e.key === 'Insert')
        ) {
          e.preventDefault?.();
          pasteFromClipboard().then((text) => {
            if (text) safePaste(text);
          });
          return false;
        }

        // Ctrl+F / Cmd+F opens search (only when not rebound above)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey && !e.altKey) {
          e.preventDefault?.();
          setSearchVisible(true);
          requestAnimationFrame(() => {
            const searchInput = document.querySelector(
              `[data-search-input="true"]`
            ) as HTMLInputElement;
            searchInput?.focus();
            searchInput?.select();
          });
          return false;
        }

        // Cross-platform Page / Scroll navigation (Shift+PageUp/Down, Shift+Home/End)
        if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
          if (e.key === 'PageUp') {
            e.preventDefault?.();
            term.scrollPages(-1);
            return false;
          }
          if (e.key === 'PageDown') {
            e.preventDefault?.();
            term.scrollPages(1);
            return false;
          }
          if (e.key === 'Home') {
            e.preventDefault?.();
            term.scrollToTop();
            return false;
          }
          if (e.key === 'End') {
            e.preventDefault?.();
            term.scrollToBottom();
            return false;
          }
        }

        // macOS standard shortcuts (Cmd+K to clear, Cmd+A to select all)
        if (isMac && e.metaKey && !e.ctrlKey && !e.altKey) {
          if (e.key.toLowerCase() === 'k') {
            term.clear();
            return false;
          }
          if (e.key.toLowerCase() === 'a') {
            term.selectAll();
            return false;
          }
        }

        // Unbound → PTY (legacy encoding, or kitty CSI-u when enabled)
        const kittySeq = kittyEncodeKey(e, kitty.getFlags());
        if (kittySeq) {
          invoke('write_pty', { sessionId, data: kittySeq }).catch(() => {});
          return false;
        }
        return true;
      });

      // ─ DA1 & DA2 Device Attributes Conformance ───────────────────────
      term.parser.registerCsiHandler({ final: 'c' }, (params) => {
        if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
          invoke('write_pty', { sessionId, data: '\x1b[?61;4c' }).catch(() => {});
          return true;
        }
        return false;
      });

      term.parser.registerCsiHandler({ prefix: '>', final: 'c' }, () => {
        invoke('write_pty', { sessionId, data: '\x1b[>1;10;0c' }).catch(() => {});
        return true;
      });

      // ─ VS Code Shell Integration & OSC Handlers ───────────────────────
      // OSC 0 & OSC 2: Window / Tab Title updates
      const handleTitle = (title: string) => {
        const clean = title.trim();
        if (clean) onTitleChangeRef.current?.(clean);
      };
      term.onTitleChange(handleTitle);
      term.parser.registerOscHandler(0, (data) => {
        handleTitle(data);
        return true;
      });
      term.parser.registerOscHandler(2, (data) => {
        handleTitle(data);
        return true;
      });

      // OSC 7 & OSC 9: Current Working Directory (CWD) updates
      term.parser.registerOscHandler(7, (data) => {
        try {
          const url = new URL(data);
          let path = decodeURIComponent(url.pathname);
          if (/^\/[a-zA-Z]:/.test(path)) path = path.slice(1);
          onCwdChangeRef.current?.(path);
        } catch {
          onCwdChangeRef.current?.(data);
        }
        return true;
      });

      term.parser.registerOscHandler(9, (data) => {
        if (data.startsWith('9;')) {
          const path = data.slice(2).replace(/^["']|["']$/g, '');
          onCwdChangeRef.current?.(path);
          return true;
        }
        return false;
      });

      // OSC 133 & OSC 633: FinalTerm and VS Code Prompt / Command markers
      term.parser.registerOscHandler(133, () => true);
      term.parser.registerOscHandler(633, () => true);

      // ─ VS Code TerminalResizeDebouncer Pattern ───────────────────────────
      // During active drag/resize, horizontal dimension changes are debounced by 100ms.
      // This prevents sending rapid SIGWINCH signals to shells (like bash / readline) on every
      // intermediate frame, eliminating ghost wrapped lines and duplicate prompts ($ \n $).
      // When the drag settles, xterm.resize and resize_pty execute in lockstep.
      let ptyResizeTimer: ReturnType<typeof setTimeout> | null = null;
      const requestResize = (cols: number, rows: number, immediate: boolean = false) => {
        const currentTerm = termRef.current;
        if (!currentTerm || !isSpawnedRef.current) return;
        const clampedCols = Math.max(10, cols);
        const clampedRows = Math.max(1, rows);
        const last = lastPtyColsRowsRef.current;
        if (last && last.cols === clampedCols && last.rows === clampedRows) return;

        // Immediate fit for spawn, tab focus, font changes
        if (immediate) {
          if (ptyResizeTimer) {
            clearTimeout(ptyResizeTimer);
            ptyResizeTimer = null;
          }
          lastPtyColsRowsRef.current = { cols: clampedCols, rows: clampedRows };
          currentTerm.resize(clampedCols, clampedRows);
          invoke('resize_pty', { sessionId, cols: clampedCols, rows: clampedRows }).catch(() => {});
          return;
        }

        // Vertical resize (rows only) is safe to execute immediately without reflowing text
        if (last && last.cols === clampedCols && last.rows !== clampedRows) {
          if (ptyResizeTimer) {
            clearTimeout(ptyResizeTimer);
            ptyResizeTimer = null;
          }
          lastPtyColsRowsRef.current = { cols: clampedCols, rows: clampedRows };
          currentTerm.resize(clampedCols, clampedRows);
          invoke('resize_pty', { sessionId, cols: clampedCols, rows: clampedRows }).catch(() => {});
          return;
        }

        // Horizontal resize (cols changed): debounce by 100ms so intermediate drag frames do not
        // bombard the shell with SIGWINCH while dragging.
        if (ptyResizeTimer) clearTimeout(ptyResizeTimer);
        ptyResizeTimer = setTimeout(() => {
          if (!effectActiveRef.current || !isSpawnedRef.current) return;
          const t = termRef.current;
          if (!t) return;
          const currentLast = lastPtyColsRowsRef.current;
          if (currentLast && currentLast.cols === clampedCols && currentLast.rows === clampedRows)
            return;
          lastPtyColsRowsRef.current = { cols: clampedCols, rows: clampedRows };
          if (t.cols !== clampedCols || t.rows !== clampedRows) {
            t.resize(clampedCols, clampedRows);
          }
          invoke('resize_pty', { sessionId, cols: clampedCols, rows: clampedRows }).catch(() => {});
        }, 100);
      };

      requestResizeRef.current = requestResize;

      const resizeDispose = term.onResize(({ cols, rows }) => {
        if (!isSpawnedRef.current) return;
        const last = lastPtyColsRowsRef.current;
        if (last && last.cols === cols && last.rows === rows) return;
        requestResize(cols, rows, false);
      });

      // ─ Listen to session-scoped events from Rust ──────────────────────
      let cancelled = false;
      let unlisten: UnlistenFn | null = null;

      const eventName = `pty-data-${sessionId}`;
      const dataListenerReady = listen(eventName, (event: any) => {
        const payload = event.payload as { session_id: string; data: string };
        const chunk = payload.data;
        if (!chunk) return;

        writeBufferRef.current.push(chunk);

        // In test environments (or if buffer grows large), flush immediately
        const isTestEnv =
          typeof (globalThis as any).process !== 'undefined' &&
          (globalThis as any).process?.env?.NODE_ENV === 'test';
        if (isTestEnv || writeBufferRef.current.reduce((acc, s) => acc + s.length, 0) >= 32768) {
          flushWrites();
          return;
        }

        if (writeRafRef.current === null) {
          writeRafRef.current = requestAnimationFrame(() => {
            writeRafRef.current = null;
            flushWrites();
          });
        }
      })
        .then((fn) => {
          if (cancelled) {
            fn();
          } else {
            unlisten = fn;
          }
        })
        .catch((err) => console.error('[TerminalTab] Failed to listen:', err));

      let unlistenExit: UnlistenFn | null = null;
      listen(`pty-exit-${sessionId}`, () => {
        flushWrites();
        term.write('\r\n\x1b[31m[Process Exited]\x1b[0m\r\n');
        kitty.reset();
        onExitRef.current?.();
      }).then((fn) => {
        if (cancelled) fn();
        else unlistenExit = fn;
      });

      // ─ ResizeObserver ────────────────────────────────────────────────
      let resizeRaf: number;
      const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          if (!fitAddonRef.current || !termRef.current) return;
          (termRef.current as any)._core?._charSizeService?.measure();
          const dims = proposeSafeDimensions(fitAddonRef.current);
          if (dims) {
            requestResize(dims.cols, dims.rows, false);
          }
        });
      });

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      // ─ Spawn PTY process ─────────────────────────────────────────────
      let rafId = 0;
      let spawnAttempts = 0;
      const trySpawn = () => {
        if (!effectActiveRef.current) return;
        (term as any)._core?._charSizeService?.measure();
        const dims = proposeSafeDimensions(fitAddon);
        if (!dims && spawnAttempts < 60) {
          spawnAttempts++;
          rafId = requestAnimationFrame(trySpawn);
          return;
        }
        dataListenerReady.then(() => {
          if (!effectActiveRef.current) return;
          if (!dims && spawnAttempts >= 60) {
            console.warn('[TerminalTab] Container size timeout, using default 80x24');
          }
          spawnSession();
        });
      };

      document.fonts.ready.then(() => {
        if (!effectActiveRef.current) return;
        (term as any)._core?._charSizeService?.measure();
        const dims = proposeSafeDimensions(fitAddon);
        if (dims) {
          term.resize(dims.cols, dims.rows);
        }
        rafId = requestAnimationFrame(trySpawn);
      });

      // ─ Cleanup ───────────────────────────────────────────────────────
      return () => {
        effectActiveRef.current = false;
        isSpawnedRef.current = false;
        lastPtyColsRowsRef.current = null;
        requestResizeRef.current = null;
        // If the effect re-runs (prop change) mid-spawn, the new lifecycle
        // must be able to spawn — don't inherit the old in-flight flag.
        spawnInFlightRef.current = false;
        cancelled = true;
        flushWrites();
        if (writeRafRef.current !== null) {
          cancelAnimationFrame(writeRafRef.current);
          writeRafRef.current = null;
        }
        if (ptyResizeTimer) clearTimeout(ptyResizeTimer);
        cancelAnimationFrame(rafId);
        cancelAnimationFrame(resizeRaf);
        resizeObserver.disconnect();
        term.element?.removeEventListener('mouseup', onMouseUp);
        term.element?.removeEventListener('mousedown', onMouseDown);
        term.element?.removeEventListener('contextmenu', onContextMenu);
        dataDispose.dispose();
        selDispose.dispose();
        bellDispose.dispose();
        if (unlisten) unlisten();
        if (unlistenExit) unlistenExit();
        resizeDispose.dispose();
        try {
          webglAddonRef.current?.dispose();
        } catch {
          /* already disposed */
        }
        webglAddonRef.current = null;
        try {
          term.dispose();
        } catch (err) {
          console.error('[TerminalTab] term.dispose failed:', err);
        }
        termRef.current = null;
        fitAddonRef.current = null;

        invoke('kill_pty', { sessionId }).catch((err) =>
          console.error('[TerminalTab] kill_pty failed:', err)
        );
      };
    }, [sessionId, workspacePath, shell, shellArgs, flushWrites, spawnSession]);

    // ── GPU renderer lifecycle — attach/detach with visibility ───────────
    useEffect(() => {
      const term = termRef.current;
      if (!term || !isVisible) return;

      let addon: WebglAddon | null = null;
      try {
        addon = new WebglAddon();
        addon.onContextLoss(() => {
          try {
            addon?.dispose();
          } catch {
            /* already gone */
          }
          if (webglAddonRef.current === addon) webglAddonRef.current = null;
        });
        term.loadAddon(addon);
        webglAddonRef.current = addon;
        term.refresh(0, term.rows - 1);
      } catch {
        /* WebGL unsupported — xterm keeps its DOM renderer */
        addon = null;
        webglAddonRef.current = null;
      }

      return () => {
        if (addon) {
          try {
            addon.dispose();
          } catch {
            /* already gone */
          }
        }
        if (webglAddonRef.current === addon) webglAddonRef.current = null;
      };
    }, [isVisible, sessionId, workspacePath, shell, shellArgs]);

    // Apply config changes live to existing terminal instances
    useEffect(() => {
      const term = termRef.current;
      if (!term) return;

      term.options.theme = terminalConfig.theme;
      term.options.cursorStyle = terminalConfig.cursorStyle;
      term.options.cursorBlink = terminalConfig.cursorBlink;
      term.options.scrollback = terminalConfig.scrollback;
      term.options.macOptionIsMeta = terminalConfig.macOptionIsMeta;

      term.options.fontSize = Math.max(8, Math.min(32, terminalConfig.fontSize));
      term.options.fontFamily = terminalConfig.fontFamily;
      term.options.lineHeight = Math.max(0.8, Math.min(2.0, terminalConfig.lineHeight));
      const ls = terminalConfig.letterSpacing;
      term.options.letterSpacing = Math.max(-2, Math.min(10, Number.isFinite(ls) ? ls : 0));

      (term as any).clearTextureAtlas?.();

      let id2: number;
      const id1 = requestAnimationFrame(() => {
        (term as any)._core?._charSizeService?.measure();
        id2 = requestAnimationFrame(() => {
          if (fitAddonRef.current) {
            const dims = proposeSafeDimensions(fitAddonRef.current);
            if (dims) {
              requestResizeRef.current?.(dims.cols, dims.rows, true);
            }
          }
        });
      });
      return () => {
        cancelAnimationFrame(id1);
        cancelAnimationFrame(id2);
      };
    }, [terminalConfig]);

    const themeBg = terminalConfig.theme.background ?? '#14171a';

    return (
      <div className={styles.wrapper} style={{ backgroundColor: themeBg }}>
        {/* Terminal canvas */}
        <div
          ref={containerRef}
          className={styles.terminalContainer}
          style={{ backgroundColor: themeBg }}
        />

        <QuickActionsBar onRunAction={handleRunAction} />

        {/* Floating Copy Button */}
        {hasSelection && (
          <button
            className={styles.floatingCopyBtn}
            title="Copy selection"
            onClick={() => {
              const term = termRef.current;
              if (term && term.hasSelection()) {
                copyToClipboard(term.getSelection()).catch(() => {});
                setHasCopied(true);
                setTimeout(() => setHasCopied(false), 2000);
              }
            }}
          >
            {hasCopied ? <Check size={14} /> : <Copy size={14} />}{' '}
            <span>{hasCopied ? 'Copied' : 'Copy'}</span>
          </button>
        )}

        {/* Error overlay with retry */}
        {spawnState === 'error' && (
          <div className={styles.errorOverlay}>
            <div className={styles.errorBox}>
              <p className={styles.errorTitle}>Terminal failed to start</p>
              <p className={styles.errorMsg}>{errorMsg}</p>
              <button onClick={spawnSession} className={styles.retryBtn}>
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Search Bar (VS Code style with toggles & navigation) */}
        {searchVisible && (
          <div
            className={styles.searchBar}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          >
            <Search size={14} className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              data-search-input="true"
              placeholder="Find..."
              value={searchQuery}
              autoFocus
              onChange={(e) => {
                const query = e.target.value;
                setSearchQuery(query);
                executeSearch(query, true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  executeSearch(searchQuery, !e.shiftKey);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setSearchVisible(false);
                  searchAddonRef.current?.clearDecorations();
                  setSearchQuery('');
                  setSearchResults(null);
                  termRef.current?.focus();
                }
              }}
            />

            {/* Match status */}
            {searchQuery && (
              <span className={styles.searchResults}>
                {searchResults
                  ? searchResults.count === 0
                    ? 'No results'
                    : searchResults.count === 1
                      ? '1 result'
                      : `${searchResults.index} of ${searchResults.count}`
                  : ''}
              </span>
            )}

            {/* Option toggles */}
            <div className={styles.searchOptionsGroup}>
              <button
                type="button"
                data-active={searchCaseSensitive ? 'true' : 'false'}
                className={cx(
                  styles.searchOptionBtn,
                  searchCaseSensitive && styles.searchOptionBtnActive
                )}
                title="Match Case (Alt+C)"
                onClick={() => {
                  const next = !searchCaseSensitive;
                  searchOptionsRef.current.caseSensitive = next;
                  setSearchCaseSensitive(next);
                  executeSearch(searchQuery, true);
                }}
              >
                Aa
              </button>
              <button
                type="button"
                data-active={searchWholeWord ? 'true' : 'false'}
                className={cx(
                  styles.searchOptionBtn,
                  searchWholeWord && styles.searchOptionBtnActive
                )}
                title="Match Whole Word (Alt+W)"
                onClick={() => {
                  const next = !searchWholeWord;
                  searchOptionsRef.current.wholeWord = next;
                  setSearchWholeWord(next);
                  executeSearch(searchQuery, true);
                }}
              >
                \b
              </button>
              <button
                type="button"
                data-active={searchRegex ? 'true' : 'false'}
                className={cx(styles.searchOptionBtn, searchRegex && styles.searchOptionBtnActive)}
                title="Use Regular Expression (Alt+R)"
                onClick={() => {
                  const next = !searchRegex;
                  searchOptionsRef.current.regex = next;
                  setSearchRegex(next);
                  executeSearch(searchQuery, true);
                }}
              >
                .*
              </button>
            </div>

            {/* Navigation buttons */}
            <div className={styles.searchNavGroup}>
              <button
                type="button"
                className={styles.searchNavBtn}
                title="Previous Match (Shift+Enter)"
                onClick={() => executeSearch(searchQuery, false)}
                disabled={!searchQuery}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                className={styles.searchNavBtn}
                title="Next Match (Enter)"
                onClick={() => executeSearch(searchQuery, true)}
                disabled={!searchQuery}
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                className={styles.searchCloseBtn}
                title="Close (Escape)"
                onClick={(e) => {
                  e.stopPropagation();
                  setSearchVisible(false);
                  searchAddonRef.current?.clearDecorations();
                  setSearchQuery('');
                  setSearchResults(null);
                  termRef.current?.focus();
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Visual Bell Indicator */}
        {bellActive && <div className={styles.bellOverlay} />}

        {/* Context Menu */}
        {contextMenu && (
          <div
            className={styles.contextMenu}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          >
            <div
              className={styles.contextMenuItem}
              onClick={() => {
                const term = termRef.current;
                if (term && term.hasSelection()) {
                  copyToClipboard(term.getSelection()).catch(() => {});
                }
                setContextMenu(null);
              }}
            >
              <Copy size={14} /> Copy
            </div>
            <div
              className={styles.contextMenuItem}
              onClick={() => {
                const term = termRef.current;
                if (term) {
                  pasteFromClipboard()
                    .then((text) => {
                      if (text) safePaste(text);
                    })
                    .catch(() => {});
                }
                setContextMenu(null);
              }}
            >
              Paste
            </div>
            <div
              className={styles.contextMenuItem}
              onClick={() => {
                const term = termRef.current;
                if (term) {
                  term.selectAll();
                  setHasSelection(true);
                }
                setContextMenu(null);
              }}
            >
              Select All
            </div>
            <div className={styles.contextMenuDivider} />
            <div
              className={styles.contextMenuItem}
              onClick={() => {
                const term = termRef.current;
                if (term) term.clear();
                setContextMenu(null);
              }}
            >
              Clear
            </div>
          </div>
        )}

        {/* Click outside to close context menu */}
        {contextMenu && (
          <div className={styles.contextMenuBackdrop} onClick={() => setContextMenu(null)} />
        )}
      </div>
    );
  }
);

TerminalTab.displayName = 'TerminalTab';

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = {
  wrapper: css`
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background-color: #14171a;
    overflow: hidden;
    position: relative;
  `,
  terminalContainer: css`
    flex: 1;
    width: 100%;
    min-height: 0;
    background-color: #14171a;
  `,
  floatingCopyBtn: css`
    position: absolute;
    top: 12px;
    right: 24px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(8, 9, 11, 0.88);
    backdrop-filter: blur(4px);
    color: #e9e6da;
    font-size: 12px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(86, 93, 97, 0.28);
    cursor: pointer;
    z-index: 20;
    transition: all 0.2s;
    &:hover {
      background: rgba(20, 23, 26, 0.95);
      border-color: rgba(86, 93, 97, 0.45);
    }
  `,
  errorOverlay: css`
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(8, 9, 11, 0.9);
    backdrop-filter: blur(4px);
    z-index: 10;
  `,
  errorBox: css`
    text-align: center;
    max-width: 360px;
    padding: 24px;
    border-radius: var(--radius-lg);
    background: #21262a;
    border: 1px solid rgba(192, 57, 43, 0.45);
    box-shadow:
      0 0 0 1px rgba(192, 57, 43, 0.15),
      var(--shadow-md);
  `,
  errorTitle: css`
    font-size: 14px;
    font-weight: 700;
    color: #b8493a;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
  errorMsg: css`
    font-size: 12px;
    color: #a3aaad;
    margin-bottom: 16px;
    word-break: break-word;
    font-family: 'Fira Code', monospace;
  `,
  retryBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #2f8f7a;
    color: #e9e6da;
    font-size: 12px;
    font-weight: 700;
    padding: 8px 20px;
    border-radius: var(--radius-md);
    border: none;
    cursor: pointer;
    transition: background 150ms ease;
    &:hover {
      background: #d1503f;
    }
  `,
  // Search Bar styles
  searchBar: css`
    position: absolute;
    top: 10px;
    right: 20px;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(20, 23, 26, 0.95);
    backdrop-filter: blur(12px);
    padding: 4px 8px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(86, 93, 97, 0.3);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    z-index: 30;
    color: #e9e6da;
  `,
  searchIcon: css`
    color: #6b7276;
    margin-left: 2px;
  `,
  searchInput: css`
    background: transparent;
    border: none;
    outline: none;
    color: #e9e6da;
    font-size: 12px;
    font-family: 'Fira Code', monospace;
    width: 170px;
    padding: 4px 6px;
    &::placeholder {
      color: #6b7276;
    }
  `,
  searchResults: css`
    font-size: 11px;
    color: #a3aaad;
    white-space: nowrap;
    padding: 0 4px;
    min-width: 45px;
    text-align: center;
  `,
  searchOptionsGroup: css`
    display: flex;
    align-items: center;
    gap: 2px;
    border-left: 1px solid rgba(86, 93, 97, 0.2);
    border-right: 1px solid rgba(86, 93, 97, 0.2);
    padding: 0 4px;
  `,
  searchOptionBtn: css`
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    color: #a3aaad;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    font-family: 'Fira Code', monospace;
    padding: 2px 5px;
    border-radius: var(--radius-sm);
    transition: all 120ms ease;
    &:hover {
      background: rgba(86, 93, 97, 0.14);
      color: #e9e6da;
    }
  `,
  searchOptionBtnActive: css`
    background: rgba(47, 143, 122, 0.25) !important;
    border-color: rgba(47, 143, 122, 0.6) !important;
    color: #e8a89e !important;
  `,
  searchNavGroup: css`
    display: flex;
    align-items: center;
    gap: 2px;
  `,
  searchNavBtn: css`
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #a3aaad;
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    transition: all 120ms ease;
    &:hover:not(:disabled) {
      background: rgba(86, 93, 97, 0.16);
      color: #e9e6da;
    }
    &:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
  `,
  searchCloseBtn: css`
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #a3aaad;
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    transition: all 120ms ease;
    &:hover {
      background: rgba(192, 57, 43, 0.22);
      color: #b8493a;
    }
  `,
  // Visual Bell styles
  bellOverlay: css`
    position: absolute;
    inset: 0;
    background: rgba(233, 230, 218, 0.12);
    pointer-events: none;
    animation: bell-flash 0.2s ease-out;
    @keyframes bell-flash {
      0% {
        opacity: 0.3;
      }
      100% {
        opacity: 0;
      }
    }
  `,
  // Context Menu styles
  contextMenu: css`
    position: fixed;
    min-width: 160px;
    background: rgba(20, 23, 26, 0.97);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(86, 93, 97, 0.28);
    border-radius: var(--radius-md);
    padding: 4px;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  `,
  contextMenuItem: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    color: #e9e6da;
    font-size: 13px;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background 100ms ease;
    &:hover {
      background: rgba(86, 93, 97, 0.14);
    }
  `,
  contextMenuDivider: css`
    height: 1px;
    background: rgba(86, 93, 97, 0.18);
    margin: 4px 0;
  `,
  contextMenuBackdrop: css`
    position: fixed;
    inset: 0;
    z-index: 999;
  `,
};
