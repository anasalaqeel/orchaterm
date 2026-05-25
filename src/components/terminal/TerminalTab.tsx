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
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [spawnState, setSpawnState] = useState<SpawnState>('idle');
    const [errorMsg, setErrorMsg] = useState('');

    // ── Expose fit() to parent via ref ───────────────────────────────────
    useImperativeHandle(ref, () => ({
      fit: () => {
        if (!fitAddonRef.current || !termRef.current) return;
        const dims = safeFit(fitAddonRef.current);
        if (dims) {
          invoke('resize_pty', { sessionId, cols: dims.cols, rows: dims.rows }).catch(() => {});
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
          shellArgs: shellArgs ?? [],
        });
        setSpawnState('running');
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

      // ─ xterm instance ────────────────────────────────────────────────
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 5000,
        theme: {
          background: '#0C0C0C',
          foreground: '#d4d4d4',
          cursor: '#7B68EE',
          cursorAccent: '#0C0C0C',
          selectionBackground: 'rgba(158, 255, 255, 0.25)',
          selectionForeground: '#ffffff',
          black: '#1a1a1a',
          brightBlack: '#4a4a4a',
          red: '#ff6262',
          brightRed: '#ff8080',
          green: '#3ad900',
          brightGreen: '#57ff1a',
          yellow: '#ffc56f',
          brightYellow: '#ffd699',
          blue: '#4db8ff',
          brightBlue: '#80ccff',
          magenta: '#ff76ff',
          brightMagenta: '#ffaaff',
          cyan: '#9ed9ff',
          brightCyan: '#c2e9ff',
          white: '#d4d4d4',
          brightWhite: '#ffffff',
        },
        fontFamily:
          "'Fira Code', 'Cascadia Code', Consolas, Monaco, 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 1.4,
        letterSpacing: 0,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // ─ Initial fit (on next frame so the DOM has settled) ────────────
      requestAnimationFrame(() => {
        safeFit(fitAddon);
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
          const dims = safeFit(fitAddonRef.current);
          if (dims && (dims.cols !== termRef.current.cols || dims.rows !== termRef.current.rows)) {
            invoke('resize_pty', { sessionId, cols: dims.cols, rows: dims.rows }).catch(() => {});
          }
        }, 100);
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
      }, [sessionId, workspacePath, shell, shellArgs]);

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
