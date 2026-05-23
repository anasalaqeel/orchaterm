import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { css } from '@emotion/css';

// ── Public ref handle exposed to TerminalContainer ─────────────────────────
export interface TerminalTabHandle {
  /** Re-fit the terminal to its container (call after tab becomes visible). */
  fit: () => void;
}

interface TerminalTabProps {
  sessionId: string;
  workspacePath: string;
  /** Shell executable path (e.g. "powershell.exe"). Passed as a prop so
   *  there is no stale closure over context values. */
  shell: string;
}

type SpawnState = 'idle' | 'spawning' | 'running' | 'error';

export const TerminalTab = forwardRef<TerminalTabHandle, TerminalTabProps>(
  ({ sessionId, workspacePath, shell }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [spawnState, setSpawnState] = useState<SpawnState>('idle');
    const [errorMsg, setErrorMsg] = useState('');

    // ── Expose fit() to parent via ref ───────────────────────────────────
    useImperativeHandle(ref, () => ({
      fit: () => {
        if (!fitAddonRef.current || !termRef.current) return;
        try {
          fitAddonRef.current.fit();
          const { cols, rows } = termRef.current;
          if (cols > 0 && rows > 0) {
            invoke('resize_pty', { sessionId, cols, rows }).catch(() => {});
          }
        } catch {
          // Container may not be visible yet — ignore.
        }
      },
    }));

    // ── Spawn helper (used for initial spawn AND retry) ──────────────────
    const spawnSession = useCallback(async () => {
      const term = termRef.current;
      if (!term) return;

      setSpawnState('spawning');
      setErrorMsg('');

      // Safe default dimensions — the ResizeObserver will correct them shortly.
      const cols = 80;
      const rows = 24;

      try {
        await invoke('spawn_pty', {
          sessionId,
          workspacePath,
          cols,
          rows,
          shell,
        });
        setSpawnState('running');
      } catch (err: any) {
        const msg = typeof err === 'string' ? err : err?.message ?? 'Unknown error';
        setSpawnState('error');
        setErrorMsg(msg);
        term.write(`\r\n\x1b[31m[Error] Failed to spawn shell: ${msg}\x1b[0m\r\n`);
      }
    }, [sessionId, workspacePath, shell]);

    // ── Main effect — creates xterm, wires listeners, spawns PTY ─────────
    useEffect(() => {
      if (!containerRef.current) return;

      // ─ xterm instance ────────────────────────────────────────────────
      const term = new Terminal({
        cursorBlink: true,
        theme: {
          background: '#0d2131',
          foreground: '#ffffff',
          cursor: '#FF9D00',
          selectionBackground: 'rgba(158, 255, 255, 0.3)',
          black: '#000000',
          red: '#ff6262',
          green: '#3ad900',
          yellow: '#ffc56f',
          blue: '#008b94',
          magenta: '#ff76ff',
          cyan: '#9ed9ff',
          white: '#e3e3e3',
        },
        fontFamily:
          "'Fira Code', Consolas, Monaco, 'Courier New', Courier, monospace",
        fontSize: 13,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // ─ Initial fit (on next frame so the DOM has settled) ────────────
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {
          // Container may have zero size if the tab is still hidden.
        }
      });

      // ─ Forward keyboard input → PTY ──────────────────────────────────
      const dataDispose = term.onData((data) => {
        invoke('write_pty', { sessionId, data }).catch((err) =>
          console.error('[TerminalTab] write_pty failed:', err),
        );
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
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;

      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimer !== null) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (!fitAddonRef.current || !termRef.current) return;
          try {
            const proposed = fitAddonRef.current.proposeDimensions();
            if (!proposed) return;
            const { cols, rows } = proposed;
            if (
              cols > 0 &&
              rows > 0 &&
              (cols !== termRef.current.cols || rows !== termRef.current.rows)
            ) {
              fitAddonRef.current.fit();
              invoke('resize_pty', { sessionId, cols, rows }).catch(() => {});
            }
          } catch {
            // Ignore — container might be transitioning.
          }
        }, 100); // 100ms debounce
      });

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      // ─ Spawn the PTY process ─────────────────────────────────────────
      // spawnSession() reads termRef.current (set above) and invokes spawn_pty.
      spawnSession();

      // ─ Cleanup ───────────────────────────────────────────────────────
      return () => {
        cancelled = true;
        if (resizeTimer !== null) clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        dataDispose.dispose();
        if (unlisten) unlisten();
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;

        invoke('kill_pty', { sessionId }).catch((err) =>
          console.error('[TerminalTab] kill_pty failed:', err),
        );
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, workspacePath, shell]);

    return (
      <div className={styles.wrapper}>
        {/* Terminal canvas */}
        <div ref={containerRef} className={styles.terminalContainer} />

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
    background-color: #0d2131;
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
    overflow: hidden;
    position: relative;
  `,
  terminalContainer: css`
    flex: 1;
    width: 100%;
    min-height: 0;
  `,
  errorOverlay: css`
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(13, 33, 49, 0.85);
    backdrop-filter: blur(4px);
    z-index: 10;
  `,
  errorBox: css`
    text-align: center;
    max-width: 360px;
    padding: 24px;
    border-radius: 12px;
    background: #0b1b28;
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
