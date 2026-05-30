import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { css } from '@emotion/css';
import { Copy, Check } from 'lucide-react';
import { terminalGainedFocus, terminalLostFocus } from '../../services/terminalFocus';
import { useDashboard } from '../../context/DashboardContext';
import { DEFAULT_TERMINAL_CONFIG, buildCombo } from '../../utils/terminalThemes';

// ── Public ref handle exposed to TerminalContainer ─────────────────────────
export interface TerminalTabHandle {
  /** Re-fit the terminal to its container (call after tab becomes visible). */
  fit: () => void;
  /** Focus the xterm instance so keyboard input is captured. */
  focus: () => void;
}

interface TerminalTabProps {
  sessionId: string;
  workspacePath: string;
  /** Shell executable (e.g. "powershell", "wsl"). */
  shell: string;
  /** Optional extra args forwarded to spawn_pty (e.g. ["--", "bash"] for wsl). */
  shellArgs?: string[];
}

type SpawnState = 'idle' | 'spawning' | 'running' | 'error';

// ── Safe fit helper ────────────────────────────────────────────────────────────
// Always probe proposeDimensions() before calling fit(). If the container has
// zero size, proposeDimensions() returns undefined and fit() crashes internally
// trying to read .dimensions on that undefined value.
function safeFit(addon: FitAddon): { cols: number; rows: number } | null {
  try {
    const dims = addon.proposeDimensions();
    if (!dims || dims.cols <= 0 || dims.rows <= 0) return null;
    addon.fit();
    return dims;
  } catch {
    return null;
  }
}

export const TerminalTab = forwardRef<TerminalTabHandle, TerminalTabProps>(
  ({ sessionId, workspacePath, shell, shellArgs }, ref) => {
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
    // Guard against React StrictMode double-invocation. When StrictMode runs
    // cleanup immediately after the first effect, it sets this to true so the
    // second (redundant) invocation is a no-op. Manually triggered retries
    // reset this flag because they come from the retry button, not from the
    // effect re-running with the same deps.
    const effectActiveRef = useRef(false);
    // True once the PTY is alive — allows the term.onResize handler to call
    // resize_pty without racing a spawn that hasn't returned yet.
    const isSpawnedRef = useRef(false);

    // ── Expose fit() to parent via ref ───────────────────────────────────
    // safeFit → fit() → term.onResize fires → resize_pty (if spawned).
    // No need to call resize_pty directly here.
    useImperativeHandle(ref, () => ({
      fit: () => {
        if (!fitAddonRef.current) return;
        safeFit(fitAddonRef.current);
      },
      focus: () => {
        termRef.current?.focus();
      },
    }));

    // ── Spawn helper (used for initial spawn AND retry) ──────────────────
    const spawnSession = useCallback(async () => {
      const term = termRef.current;
      if (!term) return;

      setSpawnState('spawning');
      setErrorMsg('');

      // Fit first so the PTY starts with the real terminal dimensions.
      // When called from the rAF (normal start-up) the container has already
      // settled so safeFit returns real dims. On Retry clicks the container
      // is already sized too. Use current xterm.js cols/rows as fallback
      // (safer than the hardcoded 80×24 — xterm may have already been fitted).
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

        // Mark PTY as live so the onResize handler starts forwarding size changes.
        isSpawnedRef.current = true;
        setSpawnState('running');

        // Focus xterm now that the PTY is alive and ready for input.
        termRef.current?.focus();

        // If xterm.js was resized while we were awaiting spawn_pty (unlikely
        // but possible), correct the PTY now.
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

    // ── Main effect — creates xterm, wires listeners, spawns PTY ─────────
    useEffect(() => {
      if (!containerRef.current) return;
      // If the effect is already active (StrictMode double-invocation in dev),
      // skip this redundant run. The flag is reset in cleanup so a genuine
      // re-run (deps change or manual retry) still works correctly.
      if (effectActiveRef.current) return;
      effectActiveRef.current = true;

      // ─ xterm instance ────────────────────────────────────────────────
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
        letterSpacing: Number.isFinite(terminalConfig.letterSpacing) ? terminalConfig.letterSpacing : 0,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // ─ Track focus so keyboardManager knows when terminal is active ───
      // xterm's hidden textarea is the actual keyboard-capture element.
      // We listen on it directly since onFocus/onBlur are proposed-API only.
      const onFocusIn  = () => terminalGainedFocus();
      const onFocusOut = () => terminalLostFocus();
      term.textarea?.addEventListener('focus', onFocusIn);
      term.textarea?.addEventListener('blur',  onFocusOut);

      // ─ Mouse shortcuts (Linux middle-click paste) ─────────────
      const onMouseUp = (e: MouseEvent) => {
        if (e.button === 1) {
          e.preventDefault();
          const selection = term.getSelection();
          if (selection) {
            invoke('write_pty', { sessionId, data: selection }).catch(() => {});
          } else if (navigator.clipboard) {
            navigator.clipboard.readText().then(text => {
              if (text) invoke('write_pty', { sessionId, data: text }).catch(() => {});
            }).catch(() => {});
          }
        }
      };
      const onMouseDown = (e: MouseEvent) => {
        if (e.button === 1) e.preventDefault(); // Prevent browser autoscroll
      };
      
      term.element?.addEventListener('mouseup', onMouseUp);
      term.element?.addEventListener('mousedown', onMouseDown);

      const selDispose = term.onSelectionChange(() => {
        setHasSelection(term.hasSelection());
      });

      // ─ Forward keyboard input → PTY ──────────────────────────────────
      const dataDispose = term.onData((data) => {
        invoke('write_pty', { sessionId, data }).catch((err) =>
          console.error('[TerminalTab] write_pty failed:', err),
        );
      });

      // ─ xterm.js → PTY size sync (primary resize mechanism) ──────────
      // term.onResize fires whenever xterm.js cols/rows actually change —
      // whether from fit() after a container resize or from switchTab.
      // This is the most direct path: no polling, no comparison bugs.
      // We guard on isSpawnedRef so we never call resize_pty before the
      // PTY process exists.
      const resizeDispose = term.onResize(({ cols, rows }) => {
        if (isSpawnedRef.current) {
          invoke('resize_pty', { sessionId, cols, rows }).catch(() => {});
        }
      });

      // ─ Listen to session-scoped event from Rust ──────────────────────
      // We store both the cleanup function AND a "cancelled" flag so that
      // if the component unmounts before the promise resolves we still
      // clean up properly.
      let cancelled = false;
      let unlisten: UnlistenFn | null = null;

      const eventName = `pty-data-${sessionId}`;
      listen(eventName, (event: any) => {
        const payload = event.payload as { session_id: string; data: string };
        term.write(payload.data);
      })
        .then((fn) => {
          if (cancelled) {
            // Component already unmounted — immediately detach.
            fn();
          } else {
            unlisten = fn;
          }
        })
        .catch((err) =>
          console.error('[TerminalTab] Failed to listen:', err),
        );

      // ─ ResizeObserver with debounce ──────────────────────────────────
      // Only responsibility: call safeFit when the container element changes
      // size. The term.onResize handler above forwards any resulting dimension
      // change to the PTY — no resize_pty call needed here.
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;

      let resizeRaf1: number, resizeRaf2: number;
      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimer !== null) clearTimeout(resizeTimer);
        cancelAnimationFrame(resizeRaf1);
        cancelAnimationFrame(resizeRaf2);
        resizeTimer = setTimeout(() => {
          if (!fitAddonRef.current || !termRef.current) return;
          // charSizeService.measure() reads measureElement.offsetWidth (DOM span
          // with 32 "W"s). While the terminal is display:none, offsetWidth=0 so
          // measure() silently no-ops and _charSizeService.width stays stale.
          // Calling it here — after the container is visible again — gives xterm
          // fresh char metrics so proposeDimensions() calculates correct cols/rows.
          (termRef.current as any)._core?._charSizeService?.measure();
          safeFit(fitAddonRef.current);
          resizeRaf1 = requestAnimationFrame(() => {
            resizeRaf2 = requestAnimationFrame(() => {
              if (fitAddonRef.current) safeFit(fitAddonRef.current);
            });
          });
        }, 100);
      });

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      // ─ Spawn the PTY process (inside rAF so dims are correct) ──────────
      // Deferring to rAF ensures CSS flex layout has resolved and safeFit
      // returns the real terminal dimensions before spawn_pty is called.
      const rafId = requestAnimationFrame(() => {
        if (!effectActiveRef.current) return; // guard: component may have unmounted
        safeFit(fitAddon);   // fit xterm.js; onResize fires but isSpawnedRef=false → no-op
        spawnSession();      // reads fitted dims, spawns PTY, then sets isSpawnedRef=true
      });

      // ─ Cleanup ───────────────────────────────────────────────────────
      return () => {
        // Reset the guard so a genuine re-run (deps change) works correctly.
        effectActiveRef.current = false;
        isSpawnedRef.current = false;
        cancelled = true;
        cancelAnimationFrame(rafId);
        cancelAnimationFrame(resizeRaf1);
        cancelAnimationFrame(resizeRaf2);
        if (resizeTimer !== null) clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        term.textarea?.removeEventListener('focus', onFocusIn);
        term.textarea?.removeEventListener('blur',  onFocusOut);
        term.element?.removeEventListener('mouseup', onMouseUp);
        term.element?.removeEventListener('mousedown', onMouseDown);
        terminalLostFocus(); // ensure count stays consistent on unmount
        dataDispose.dispose();
        selDispose.dispose();
        if (unlisten) unlisten();
        resizeDispose.dispose();
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;

        invoke('kill_pty', { sessionId }).catch((err) =>
          console.error('[TerminalTab] kill_pty failed:', err),
        );
      };
      }, [sessionId, workspacePath, shell, shellArgs]);

    // Apply config changes live to existing terminal instances.
    useEffect(() => {
      const term = termRef.current;
      if (!term) return;

      // Non-layout options — safe to apply synchronously.
      term.options.theme           = terminalConfig.theme;
      term.options.cursorStyle     = terminalConfig.cursorStyle;
      term.options.cursorBlink     = terminalConfig.cursorBlink;
      term.options.scrollback      = terminalConfig.scrollback;
      term.options.macOptionIsMeta = terminalConfig.macOptionIsMeta;

      // Font options change cell metrics — clamp to valid range so intermediate
      // typed values (e.g. typing "14" passes through "1") never corrupt layout.
      term.options.fontSize     = Math.max(8, Math.min(32, terminalConfig.fontSize));
      term.options.fontFamily   = terminalConfig.fontFamily;
      term.options.lineHeight   = Math.max(0.8, Math.min(2.0, terminalConfig.lineHeight));
      const ls = terminalConfig.letterSpacing;
      term.options.letterSpacing = Math.max(-2, Math.min(10, Number.isFinite(ls) ? ls : 0));

      // Clear the glyph texture atlas so xterm rebuilds it at the new font size.
      // Without this, cached bitmaps from the old size get reused and look wrong.
      (term as any).clearTextureAtlas?.();

      // Force re-measure then fit. Setting term.options.fontSize while
      // display:none silently leaves charSizeService.width stale (offsetWidth=0).
      // Calling measure() here handles the visible case; the ResizeObserver
      // path handles the hidden→visible transition.
      let id2: number;
      const id1 = requestAnimationFrame(() => {
        (term as any)._core?._charSizeService?.measure();
        id2 = requestAnimationFrame(() => {
          if (fitAddonRef.current) safeFit(fitAddonRef.current);
        });
      });
      return () => { cancelAnimationFrame(id1); cancelAnimationFrame(id2); };
    }, [terminalConfig]);

    useEffect(() => {
      const term = termRef.current;
      if (!term) return;
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.type !== 'keydown') return true;
        const combo = buildCombo(e);
        let binding = terminalConfig.keybindings.find(b => b.key === combo);
        
        if (!binding) {
          if (combo === 'ctrl+shift+c') binding = { key: combo, action: 'copy' };
          else return true;
        }

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
            if (term.hasSelection() && navigator.clipboard) {
              navigator.clipboard.writeText(term.getSelection()).catch(() => {});
              term.clearSelection();
            }
            break;
          case 'paste':
            if (navigator.clipboard) {
              navigator.clipboard.readText().then(text => {
                if (text) invoke('write_pty', { sessionId, data: text }).catch(() => {});
              }).catch(() => {});
            }
            break;
        }
        return false;
      });
    }, [terminalConfig.keybindings, sessionId]);

    return (
      <div className={styles.wrapper}>
        {/* Terminal canvas */}
        <div ref={containerRef} className={styles.terminalContainer} />

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
                term.clearSelection();
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
    /* xterm renders its own canvas; this colour shows only in any gap
       before the canvas is attached or while transitioning. */
    background-color: #070d14;
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
};
