/*
 * WindowControls.tsx
 *
 * Caption buttons (minimize / maximize-restore / close) for the undecorated
 * main window. The native title bar is disabled in tauri.conf.json
 * (`decorations: false`), so these replace it — flush to the top-right corner
 * in the console tab strip, or inset with rounded corners on padded pages.
 *
 * Drag regions are handled separately via `data-tauri-drag-region` on the
 * surrounding chrome (Tauri's injected script starts a drag on mousedown and
 * toggles maximize on double-click automatically; button elements are exempt).
 */
import { useEffect, useState } from 'react';
import { getCurrentWindow, type Window as TauriWindow } from '@tauri-apps/api/window';
import { css, cx } from '@emotion/css';
import { Minus, Square, Copy, X } from 'lucide-react';

// Resolved lazily — getCurrentWindow() throws outside Tauri (tests, plain
// browser dev), and a module-level call would crash test collection.
let appWindow: TauriWindow | null = null;
function getWindow(): TauriWindow | null {
  if (appWindow) return appWindow;
  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      appWindow = getCurrentWindow();
    }
  } catch {
    appWindow = null;
  }
  return appWindow;
}

interface WindowControlsProps {
  /**
   * true → square corners, zero margin: sits flush against the window's
   * top-right corner (console tab strip). false → rounded, slightly inset
   * (padded page headers).
   */
  flush?: boolean;
}

export function WindowControls({ flush = false }: WindowControlsProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getWindow();
    if (!win) return;
    let disposed = false;
    const sync = () =>
      win
        .isMaximized()
        .then((v) => {
          if (!disposed) setMaximized(v);
        })
        .catch(() => {});
    sync();
    const unlistenP = win.onResized(sync);
    return () => {
      disposed = true;
      unlistenP.then((un) => un()).catch(() => {});
    };
  }, []);

  return (
    <div
      className={cx(wc.controls, flush ? wc.flush : wc.inset)}
      // Swallow double-clicks so rapid clicking two buttons can't bubble into
      // any ancestor drag-region double-click → maximize toggle.
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        className={wc.btn}
        title="Minimize"
        aria-label="Minimize window"
        onClick={() =>
          getWindow()
            ?.minimize()
            .catch(() => {})
        }
      >
        <Minus size={13} />
      </button>
      <button
        className={wc.btn}
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        onClick={() =>
          getWindow()
            ?.toggleMaximize()
            .catch(() => {})
        }
      >
        {maximized ? <Copy size={11} /> : <Square size={11} />}
      </button>
      <button
        className={cx(wc.btn, wc.close)}
        title="Close"
        aria-label="Close window"
        onClick={() =>
          getWindow()
            ?.close()
            .catch(() => {})
        }
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────── */

const wc = {
  controls: css`
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    height: 34px;
    user-select: none;
  `,
  /* Flush variant — reaches the window edge (console tab strip). */
  flush: css`
    align-self: stretch;
    height: auto;
    margin-left: 10px;
  `,
  /* Inset variant — floats inside a padded page header. */
  inset: css`
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    overflow: hidden;
    margin-left: 12px;
  `,
  btn: css`
    width: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: default; /* caption buttons don't show a pointer */
    transition:
      background 0.12s ease,
      color 0.12s ease;
    &:hover {
      background: rgba(255, 255, 255, 0.07);
      color: var(--text-primary);
    }
    &:active {
      background: rgba(255, 255, 255, 0.12);
    }
  `,
  close: css`
    &:hover {
      background: #e81123; /* Windows caption-close red */
      color: #fff;
    }
    &:active {
      background: #c50f1f;
      color: #fff;
    }
  `,
};
