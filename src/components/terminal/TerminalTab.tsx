import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from 'react';
import { Terminal, FitAddon } from 'ghostty-web';
import type { IDisposable } from 'ghostty-web';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { css } from '@emotion/css';
import { Copy, Check, Search, X } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { DEFAULT_TERMINAL_CONFIG, buildCombo, resolveTerminalKey } from '../../utils/terminalThemes';
import { ensureGhostty } from '../../utils/ghosttyInit';
import { UrlLinkProvider } from '../../utils/linkProviders';
import { searchBuffer, revealMatch, type SearchMatch } from '../../utils/terminalSearch';
import { writePtyChunked } from '../../utils/ptyUtils';
import { QuickActionsBar } from './QuickActionsBar';

// ── Public ref handle exposed to TerminalContainer ─────────────────────────
export interface TerminalTabHandle {
  /** Re-fit the terminal to its container (call after tab becomes visible). */
  fit: () => void;
  /** Focus the terminal so keyboard input is captured. */
  focus: () => void;
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
}

type SpawnState = 'idle' | 'spawning' | 'running' | 'error';

// ── Safe fit helper ────────────────────────────────────────────────────────────
// Probe proposeDimensions() before fit(); ghostty-web's FitAddon returns
// undefined when the container has no measurable size, and fit() would throw
// dividing by zero cell metrics in that case.
function safeFit(addon: FitAddon | null): { cols: number; rows: number } | null {
  if (!addon) return null;
  try {
    const dims = addon.proposeDimensions();
    if (!dims || dims.cols <= 0 || dims.rows <= 0) return null;
    addon.fit();
    return dims;
  } catch {
    return null;
  }
}

// Matches ANSI escapes / OSC sequences / lone control chars so we can tell
// whether a chunk has any *printable* content yet.
const ANSI_CONTROL = new RegExp('\\u001b\\][^\\u0007]*(?:\\u0007|\\u001b\\\\)|\\u001b\\[[0-9;?]*[ -\\/]*[@-~]|\\u001b[@-Z\\\\-_]|[\\u0000-\\u0009\\u000b-\\u001f\\u007f]', 'g');

/**
 * Some shells (notably Git Bash, whose default PS1 starts with `\n`) emit a
 * leading newline before the first prompt, leaving a blank row at the very top.
 * Strip exactly ONE leading newline — but only when it is the session's first
 * visible content (everything before it is escape sequences). Returns the
 * (possibly trimmed) data plus whether the one-shot decision is now resolved.
 */
function stripLeadingPromptNewline(data: string): { out: string; resolved: boolean } {
  const visible = data.replace(ANSI_CONTROL, '').replace(/\r/g, '');
  if (visible === '') return { out: data, resolved: false }; // escapes only — wait
  if (!visible.startsWith('\n')) return { out: data, resolved: true }; // printable first — leave as-is
  // Leading newline confirmed: drop the first \n (and an immediately preceding \r).
  const nl = data.indexOf('\n');
  const cut = nl > 0 && data[nl - 1] === '\r' ? nl - 1 : nl;
  return { out: data.slice(0, cut) + data.slice(nl + 1), resolved: true };
}

export const TerminalTab = forwardRef<TerminalTabHandle, TerminalTabProps>(
  ({ sessionId, workspacePath, shell, shellArgs, onExit }, ref) => {
    const { settings } = useDashboard();
    const terminalConfig = useMemo(
      () => settings.terminalConfig ?? DEFAULT_TERMINAL_CONFIG,
      [settings.terminalConfig]
    );

    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [spawnState, setSpawnState] = useState<SpawnState>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [hasSelection, setHasSelection] = useState(false);
    const [hasCopied, setHasCopied] = useState(false);

    // Search state. ghostty-web has no search addon, so we scan the buffer
    // ourselves (src/utils/terminalSearch.ts). The matches live in a ref (no
    // re-render needed per match); only the count drives the UI badge.
    const [searchVisible, setSearchVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState(0);
    const searchMatchesRef = useRef<SearchMatch[]>([]);
    const searchIndexRef = useRef(0);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    // Visual bell state
    const [bellActive, setBellActive] = useState(false);

    // True once the PTY is alive — allows the term.onResize handler to call
    // resize_pty without racing a spawn that hasn't returned yet.
    const isSpawnedRef = useRef(false);
    // Tracks the exact (cols, rows) grid size as of the last resize_pty call sent
    // to the PTY — avoids redundant IPC when dimensions haven't changed.
    const lastPtyColsRowsRef = useRef<{ cols: number; rows: number } | null>(null);

    // Live refs read inside the (long-lived) main effect so it never closes over
    // a stale value. keybindings: lets the custom key handler stay on THIS term
    // and pick up config edits without re-attaching. onExit: avoids a stale
    // callback firing on process exit after the parent re-rendered.
    const keybindingsRef = useRef(terminalConfig.keybindings);
    keybindingsRef.current = terminalConfig.keybindings;
    const onExitRef = useRef(onExit);
    onExitRef.current = onExit;

    // Snapshot of search visibility for the key handler (re-attached only on
    // effect deps change, so it must read the latest value via a ref).
    const searchVisibleRef = useRef(searchVisible);
    searchVisibleRef.current = searchVisible;
    const contextMenuRef = useRef(contextMenu);
    contextMenuRef.current = contextMenu;

    // ── Expose fit()/focus() to parent via ref ───────────────────────────
    // safeFit → fit() → term.onResize fires → resize_pty (if spawned).
    useImperativeHandle(ref, () => ({
      fit: () => {
        const term = termRef.current;
        if (!fitAddonRef.current || !term) return;
        safeFit(fitAddonRef.current);
        term.scrollToBottom();
      },
      focus: () => {
        termRef.current?.focus();
      },
    }));

    // ── Quick Actions bar → PTY ───────────────────────────────────────────
    // Wrap in bracketed-paste markers ourselves (same escape sequences the
    // emulator's paste() uses) so the shell/app sees this as one pasted blob,
    // not fast synthetic keystrokes exposed to per-character shell-side side
    // effects (autosuggestion accept, magic-space history expansion, etc.).
    // Enter sits OUTSIDE the closing marker so it submits the pasted text.
    const runQuickActionCommand = useCallback((command: string, autoExecute: boolean) => {
      const term = termRef.current;
      if (!term) return;
      const bracketed = term.hasBracketedPaste() ? `\x1b[200~${command}\x1b[201~` : command;
      const data = autoExecute ? `${bracketed}\r` : bracketed;
      writePtyChunked(sessionId, data).catch((err) =>
        console.error('[TerminalTab] write_pty failed:', err),
      );
    }, [sessionId]);

    // ── Search helpers (buffer-based, replace addon-search) ──────────────
    const runSearch = useCallback((query: string) => {
      const term = termRef.current;
      if (!query) {
        searchMatchesRef.current = [];
        searchIndexRef.current = 0;
        setSearchResults(0);
        term?.clearSelection();
        return;
      }
      if (!term) return;
      const matches = searchBuffer(term, query);
      searchMatchesRef.current = matches;
      if (matches.length > 0) {
        searchIndexRef.current = 0;
        revealMatch(term, matches[0]);
      } else {
        term.clearSelection();
      }
      setSearchResults(matches.length);
    }, []);

    const advanceSearch = useCallback((forward: boolean) => {
      const term = termRef.current;
      const matches = searchMatchesRef.current;
      if (!term || matches.length === 0) return;
      const n = matches.length;
      searchIndexRef.current = (searchIndexRef.current + (forward ? 1 : -1) + n) % n;
      revealMatch(term, matches[searchIndexRef.current]);
    }, []);

    const closeSearch = useCallback(() => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      setSearchVisible(false);
      setSearchQuery('');
      setSearchResults(0);
      searchMatchesRef.current = [];
      searchIndexRef.current = 0;
      termRef.current?.clearSelection();
      termRef.current?.focus();
    }, []);

    // Clear any pending search debounce on unmount so it can't fire after the
    // terminal (and its buffer) is gone.
    useEffect(() => () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    }, []);

    // ── Spawn helper (used for initial spawn AND retry) ──────────────────
    const spawnSession = useCallback(async () => {
      const term = termRef.current;
      if (!term) return;

      setSpawnState('spawning');
      setErrorMsg('');

      // Fit first so the PTY starts with the real terminal dimensions.
      const fitted = fitAddonRef.current ? safeFit(fitAddonRef.current) : null;
      const cols = fitted?.cols ?? term.cols;
      const rows = fitted?.rows ?? term.rows;

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

        // If the terminal was resized while we awaited spawn_pty, correct the PTY.
        const liveterm = termRef.current;
        if (liveterm && (liveterm.cols !== cols || liveterm.rows !== rows)) {
          invoke('resize_pty', {
            sessionId,
            cols: liveterm.cols,
            rows: liveterm.rows,
          }).catch(() => {});
        }
      } catch (err: any) {
        const msg = typeof err === 'string' ? err : err?.message ?? 'Unknown error';
        setSpawnState('error');
        setErrorMsg(msg);
        term.write(`\r\n\x1b[31m[Error] Failed to spawn shell: ${msg}\x1b[0m\r\n`);
      }
    }, [sessionId, workspacePath, shell, shellArgs]);

    // ── Main effect — creates ghostty-web Terminal, wires listeners, spawns PTY ─
    useEffect(() => {
      if (!containerRef.current) return;

      // Local disposed flag — the async WASM load means setup() can complete
      // after React has already run cleanup (StrictMode double-invoke, or a
      // deps change). Every async callback checks this before touching the DOM.
      let disposed = false;

      // Cleanup handles created inside setup(); null until assigned.
      let term: Terminal | null = null;
      let fitAddon: FitAddon | null = null;
      let dataDispose: IDisposable | null = null;
      let selDispose: IDisposable | null = null;
      let bellDispose: IDisposable | null = null;
      let resizeDispose: IDisposable | null = null;
      let unlisten: UnlistenFn | null = null;
      let unlistenExit: UnlistenFn | null = null;
      let resizeObserver: ResizeObserver | null = null;
      let rafId = 0;
      let resizeRaf = 0;

      const setup = async () => {
        // Load the Ghostty WASM core (cached after the first tab). This is the
        // one place that awaits: everything terminal-related happens after.
        const ghostty = await ensureGhostty();
        if (disposed || !containerRef.current) return;

        // ─ ghostty-web Terminal ──────────────────────────────────────────
        // Only options ghostty-web supports are passed (no lineHeight/
        // letterSpacing/macOptionIsMeta — those are xterm-only). Kitty keyboard
        // protocol, Unicode width, grapheme clustering and IME are native to
        // the Ghostty core, so no addons/shims are needed for them.
        term = new Terminal({
          ghostty,
          cursorBlink: terminalConfig.cursorBlink,
          cursorStyle: terminalConfig.cursorStyle,
          scrollback: terminalConfig.scrollback,
          theme: terminalConfig.theme,
          fontFamily: terminalConfig.fontFamily,
          fontSize: terminalConfig.fontSize,
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        // URL detection → opens via the Tauri opener plugin (replaces
        // addon-web-links). ghostty-web also has built-in detection; this
        // provider ensures clicks route through openUrl specifically.
        term.registerLinkProvider(new UrlLinkProvider(term));

        term.open(containerRef.current);

        termRef.current = term;
        fitAddonRef.current = fitAddon;

        // ─ Mouse shortcuts (Linux middle-click paste) ─────────────────────
        const onMouseUp = (e: MouseEvent) => {
          if (e.button === 1) {
            e.preventDefault();
            // Route through paste() so the emulator wraps the text in
            // bracketed-paste markers when mode 2004 is active.
            const selection = term!.getSelection();
            if (selection) {
              term!.paste(selection);
            } else if (navigator.clipboard) {
              navigator.clipboard.readText().then((text) => {
                if (text) term!.paste(text);
              }).catch(() => {});
            }
          }
        };
        const onMouseDown = (e: MouseEvent) => {
          if (e.button === 1) e.preventDefault(); // Prevent browser autoscroll
        };
        const onContextMenu = (e: MouseEvent) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        };

        term.element?.addEventListener('mouseup', onMouseUp);
        term.element?.addEventListener('mousedown', onMouseDown);
        term.element?.addEventListener('contextmenu', onContextMenu);

        selDispose = term.onSelectionChange(() => {
          setHasSelection(term!.hasSelection());
        });

        // ─ Visual bell handler ────────────────────────────────────────────
        bellDispose = term.onBell(() => {
          setBellActive(true);
          setTimeout(() => setBellActive(false), 200);
        });

        // ─ Forward keyboard input → PTY ──────────────────────────────────
        // Large inputs (paste) are chunked: Windows ConPTY / readline-based
        // CLIs drop characters when a big buffer arrives in a single write.
        dataDispose = term.onData((data) => {
          if (data.length > 80) {
            writePtyChunked(sessionId, data).catch((err) =>
              console.error('[TerminalTab] writePtyChunked failed:', err),
            );
          } else {
            invoke('write_pty', { sessionId, data }).catch((err) =>
              console.error('[TerminalTab] write_pty failed:', err),
            );
          }
        });

        // ─ Single keyboard authority (bound to THIS term instance) ───────
        // Reads the latest keybindings via a ref so config edits apply live
        // without re-attaching. Unbound combos (the default) return true →
        // ghostty-web encodes and forwards them to the PTY. Kitty keyboard
        // protocol is handled natively by the Ghostty core, so there is no
        // manual CSI-u encoding here (the old xterm.js shim is gone).
        term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          if (e.type !== 'keydown') return true;

          // When search is visible, only pass through Escape to close it.
          if (searchVisibleRef.current) {
            if (e.key === 'Escape') {
              closeSearch();
              return false;
            }
            return false; // the search input handles everything else
          }

          // Ctrl+F / Cmd+F for search (overrideable via keybindings).
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey && !e.altKey) {
            setSearchVisible(true);
            requestAnimationFrame(() => {
              const searchInput = document.querySelector(`[data-search-input="true"]`) as HTMLInputElement;
              searchInput?.focus();
            });
            return false;
          }

          // Escape to close context menu.
          if (e.key === 'Escape' && contextMenuRef.current) {
            setContextMenu(null);
            return false;
          }

          const binding = resolveTerminalKey(buildCombo(e), keybindingsRef.current);

          // Explicit binding — handle according to its action.
          if (binding && binding.action !== 'passthrough') {
            switch (binding.action) {
              case 'clear':         term!.clear(); break;
              case 'scroll-top':    term!.scrollToTop(); break;
              case 'scroll-bottom': term!.scrollToBottom(); break;
              case 'send-text':
                invoke('write_pty', { sessionId, data: binding.text ?? '' }).catch(() => {});
                break;
              case 'copy':
                if (term!.hasSelection() && navigator.clipboard) {
                  navigator.clipboard.writeText(term!.getSelection()).catch(() => {});
                }
                break;
              case 'paste':
                // Chromium fires a native paste for Ctrl+Shift+V (bracketed
                // paste handled by the emulator). We only consume the keydown
                // so the raw control byte never reaches the shell.
                break;
            }
            return false; // consumed
          }

          // Unbound or explicit passthrough → let ghostty-web encode & send.
          return true;
        });

        // ─ Terminal → PTY size sync (primary resize mechanism) ───────────
        resizeDispose = term.onResize(({ cols, rows }) => {
          if (!isSpawnedRef.current) return;
          const last = lastPtyColsRowsRef.current;
          if (last && last.cols === cols && last.rows === rows) return;
          lastPtyColsRowsRef.current = { cols, rows };
          invoke('resize_pty', { sessionId, cols, rows }).catch(() => {});
        });

        // ─ Listen to session-scoped PTY-data event from Rust ─────────────
        // Register the listener BEFORE spawning so the shell's initial output
        // (cursor-home / clear + first prompt) isn't dropped. One-shot: strip a
        // single leading prompt newline (e.g. Git Bash PS1 begins with `\n`).
        const eventName = `pty-data-${sessionId}`;
        let leadingNewlineResolved = false;
        const dataListenerReady = listen(eventName, (event: any) => {
            const payload = event.payload as { session_id: string; data: string };
            let data = payload.data;
            if (!leadingNewlineResolved) {
              const r = stripLeadingPromptNewline(data);
              data = r.out;
              leadingNewlineResolved = r.resolved;
            }
            term!.write(data);
          })
          .then((fn) => {
            if (disposed) {
              fn();
            } else {
              unlisten = fn;
            }
          })
          .catch((err) =>
            console.error('[TerminalTab] Failed to listen:', err),
          );

        listen(`pty-exit-${sessionId}`, () => {
          if (disposed || !term) return;
          term.write('\r\n\x1b[31m[Process Exited]\x1b[0m\r\n');
          onExitRef.current?.();
        }).then((fn) => {
          if (disposed) fn();
          else unlistenExit = fn;
        });

        // ─ ResizeObserver with rAF throttle ──────────────────────────────
        // Only job: call safeFit when the container resizes. term.onResize
        // above forwards any resulting dimension change to the PTY.
        resizeObserver = new ResizeObserver(() => {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(() => {
            if (disposed || !fitAddonRef.current || !termRef.current) return;
            safeFit(fitAddonRef.current);
            // Second pass to catch flexbox settling (scrollbars appearing/disappearing).
            requestAnimationFrame(() => {
              if (!disposed && fitAddonRef.current) safeFit(fitAddonRef.current);
            });
          });
        });
        resizeObserver.observe(containerRef.current);

        // ─ Wait for custom fonts, then spawn once dims are real ──────────
        // Deferring to rAF ensures CSS flex layout has resolved. A new tab can
        // mount before its container is laid out (size 0) — proposeDimensions
        // then returns undefined. Poll until safeFit yields valid dimensions,
        // then spawn at the correct size so a later show-fit is a no-op.
        const trySpawn = () => {
          if (disposed || !fitAddon) return;
          let spawnAttempts = 0;
          const attempt = () => {
            if (disposed) return;
            const dims = safeFit(fitAddon);
            if (!dims && spawnAttempts < 60) {
              spawnAttempts++;
              rafId = requestAnimationFrame(attempt);
              return;
            }
            dataListenerReady.then(() => {
              if (disposed) return;
              spawnSession();
            });
          };
          attempt();
        };

        // Re-fit once the web font (Fira Code) is available so cell metrics are
        // measured against the real font; any resulting size change flows to the
        // PTY via term.onResize above. Spawning is kicked off separately below so
        // font loading can neither delay nor duplicate it.
        document.fonts.ready.then(() => {
          if (disposed || !fitAddon) return;
          safeFit(fitAddon);
        });

        // Spawn on the next frame (lets flex layout settle) and poll until the
        // container has real dimensions, then wait for the PTY-data listener to
        // be attached before spawning. Exactly ONE kick-off → no double spawn.
        rafId = requestAnimationFrame(trySpawn);
      };

      // Any rejection from setup() (WASM load failure, open() throw, etc.)
      // surfaces in the error overlay instead of leaving a silent blank pane.
      setup().catch((err) => {
        if (disposed) return;
        console.error('[TerminalTab] setup failed:', err);
        setSpawnState('error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });

      // ─ Cleanup ───────────────────────────────────────────────────────
      return () => {
        disposed = true;
        isSpawnedRef.current = false;
        lastPtyColsRowsRef.current = null;
        cancelAnimationFrame(rafId);
        cancelAnimationFrame(resizeRaf);
        resizeObserver?.disconnect();
        dataDispose?.dispose();
        selDispose?.dispose();
        bellDispose?.dispose();
        resizeDispose?.dispose();
        if (unlisten) unlisten();
        if (unlistenExit) unlistenExit();
        try { term?.dispose(); } catch (err) {
          console.error('[TerminalTab] term.dispose failed:', err);
        }
        termRef.current = null;
        fitAddonRef.current = null;

        invoke('kill_pty', { sessionId }).catch((err) =>
          console.error('[TerminalTab] kill_pty failed:', err),
        );
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, workspacePath, shell, shellArgs]);

    // ── Apply config changes live to existing terminal instances ───────────
    useEffect(() => {
      const term = termRef.current;
      if (!term) return;

      // ghostty-web supports these runtime options. lineHeight, letterSpacing
      // and macOptionIsMeta are xterm-only and intentionally not applied.
      term.options.theme = terminalConfig.theme;
      term.options.cursorStyle = terminalConfig.cursorStyle;
      term.options.cursorBlink = terminalConfig.cursorBlink;
      term.options.scrollback = terminalConfig.scrollback;
      term.options.fontSize = Math.max(8, Math.min(32, terminalConfig.fontSize));
      term.options.fontFamily = terminalConfig.fontFamily;
    }, [terminalConfig]);

    // xterm only paints the cols×rows cell grid; the few px of leftover space
    // around it shows the wrapper/container background. Drive that from the
    // active theme so edges match the terminal bg when the theme changes.
    const themeBg = terminalConfig.theme.background ?? '#070d14';

    return (
      <div className={styles.wrapper} style={{ backgroundColor: themeBg }}>
        {/* Terminal canvas */}
        <div ref={containerRef} className={styles.terminalContainer} style={{ backgroundColor: themeBg }} />

        <QuickActionsBar onRunCommand={runQuickActionCommand} />

        {/* Floating Copy Button */}
        {hasSelection && (
          <button
            className={styles.floatingCopyBtn}
            title="Copy selection"
            onClick={() => {
              const term = termRef.current;
              if (term && term.hasSelection() && navigator.clipboard) {
                navigator.clipboard.writeText(term.getSelection()).catch(() => {});
                setHasCopied(true);
                setTimeout(() => setHasCopied(false), 2000);
              }
            }}
          >
            {hasCopied ? <Check size={14} /> : <Copy size={14} />} <span>{hasCopied ? 'Copied' : 'Copy'}</span>
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

        {/* Search Bar */}
        {searchVisible && (
          <div
            className={styles.searchBar}
            onMouseDown={(e) => {
              // Prevent terminal from stealing focus when clicking search bar
              e.stopPropagation();
            }}
          >
            <Search size={16} />
            <input
              type="text"
              className={styles.searchInput}
              data-search-input="true"
              placeholder="Search in terminal..."
              value={searchQuery}
              autoFocus
              onChange={(e) => {
                const query = e.target.value;
                setSearchQuery(query);
                // Debounce — searchBuffer walks the whole scrollback.
                if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                searchDebounceRef.current = setTimeout(() => runSearch(query), 150);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  advanceSearch(!e.shiftKey);
                }
              }}
            />
            {searchResults > 0 && (
              <span className={styles.searchResults}>
                {searchResults} result{searchResults !== 1 ? 's' : ''}
              </span>
            )}
            <button
              className={styles.searchCloseBtn}
              onClick={(e) => {
                e.stopPropagation();
                closeSearch();
              }}
            >
              <X size={14} />
            </button>
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
                if (term && term.hasSelection() && navigator.clipboard) {
                  navigator.clipboard.writeText(term.getSelection()).catch(() => {});
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
                if (term && navigator.clipboard) {
                  navigator.clipboard.readText().then((text) => {
                    if (text) term.paste(text);
                  }).catch(() => {});
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
                termRef.current?.clear();
                setContextMenu(null);
              }}
            >
              Clear
            </div>
          </div>
        )}

        {/* Click outside to close context menu */}
        {contextMenu && (
          <div
            className={styles.contextMenuBackdrop}
            onClick={() => setContextMenu(null)}
          />
        )}
      </div>
    );
  },
);

TerminalTab.displayName = 'TerminalTab';

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = {
  wrapper: css`
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background-color: #070d14;
    overflow: hidden;
    position: relative;
  `,
  terminalContainer: css`
    flex: 1;
    width: 100%;
    min-height: 0;
    /* ghostty-web renders into a <canvas> appended to this container. Give the
       text the same 8px inset the old .xterm padding provided, and make the
       canvas fill the resulting box. */
    padding: 8px;
    background-color: #070d14;
    & canvas {
      display: block;
    }
  `,
  floatingCopyBtn: css`
    position: absolute;
    top: 12px;
    right: 24px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(11, 21, 32, 0.85);
    backdrop-filter: blur(4px);
    color: #e2e8f0;
    font-size: 12px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    cursor: pointer;
    z-index: 20;
    transition: all 0.2s;
    &:hover {
      background: rgba(15, 28, 43, 0.95);
      border-color: rgba(255, 255, 255, 0.2);
    }
  `,
  errorOverlay: css`
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(7, 13, 20, 0.88);
    backdrop-filter: blur(4px);
    z-index: 10;
  `,
  errorBox: css`
    text-align: center;
    max-width: 360px;
    padding: 24px;
    border-radius: 12px;
    background: #0b1520;
    border: 1px solid rgba(248, 113, 113, 0.3);
  `,
  errorTitle: css`
    font-size: 14px;
    font-weight: 700;
    color: #f87171;
    margin-bottom: 8px;
  `,
  errorMsg: css`
    font-size: 12px;
    color: #94a3b8;
    margin-bottom: 16px;
    word-break: break-word;
    font-family: 'Fira Code', monospace;
  `,
  retryBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #2563eb;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: background 150ms ease;
    &:hover {
      background: #3b82f6;
    }
  `,
  // Search Bar styles
  searchBar: css`
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(11, 21, 32, 0.9);
    backdrop-filter: blur(8px);
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    z-index: 25;
    color: #e2e8f0;
  `,
  searchInput: css`
    terminal-search-input: true;
    background: transparent;
    border: none;
    outline: none;
    color: #e2e8f0;
    font-size: 13px;
    font-family: 'Fira Code', monospace;
    width: 200px;
    &::placeholder {
      color: #64748b;
    }
  `,
  searchResults: css`
    font-size: 11px;
    color: #64748b;
  `,
  searchCloseBtn: css`
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    &:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #94a3b8;
    }
  `,
  // Visual Bell styles
  bellOverlay: css`
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.1);
    pointer-events: none;
    animation: bell-flash 0.2s ease-out;
    @keyframes bell-flash {
      0% { opacity: 0.3; }
      100% { opacity: 0; }
    }
  `,
  // Context Menu styles
  contextMenu: css`
    position: fixed;
    min-width: 160px;
    background: rgba(11, 21, 32, 0.95);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 4px;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  `,
  contextMenuItem: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    color: #e2e8f0;
    font-size: 13px;
    cursor: pointer;
    border-radius: 4px;
    transition: background 100ms ease;
    &:hover {
      background: rgba(255, 255, 255, 0.08);
    }
  `,
  contextMenuDivider: css`
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 4px 0;
  `,
  contextMenuBackdrop: css`
    position: fixed;
    inset: 0;
    z-index: 999;
  `,
};
