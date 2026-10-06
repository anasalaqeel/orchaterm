/*
 * WindowControls.tsx
 *
 * Caption buttons (minimize / maximize-restore / close) for the undecorated
 * main window on Windows/Linux (`decorations: false` in tauri.conf.json
 * disables the native title bar there).
 *
 * On macOS, native decorations are enabled via tauri.macos.conf.json, so this
 * component renders nothing there (`isMacOS` check).
 *
 * Drag regions are handled separately via `data-tauri-drag-region` on the
 * surrounding chrome (Tauri's injected script starts a drag on mousedown and
 * toggles maximize on double-click automatically; button elements are exempt).
 */
import { useEffect, useState } from 'react';
import { getCurrentWindow, type Window as TauriWindow } from '@tauri-apps/api/window';
import { css, cx } from '@emotion/css';
import { Minus, Square, Copy, X } from 'lucide-react';
import { isMacOS } from '../../utils/platform';

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

export interface WindowControlsProps {
  /**
   * true → square corners, zero margin, full height: sits flush against the
   * window's top-right corner (console tab strip or right panel header).
   * false → rounded, slightly inset (padded page headers like Overview, TaskLog, Settings).
   */
  flush?: boolean;
}

export function WindowControls({ flush = false }: WindowControlsProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (isMacOS) return;
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
    const unlistenResize = win.onResized(sync);
    return () => {
      disposed = true;
      unlistenResize.then((un) => un()).catch(() => {});
    };
  }, []);

  if (isMacOS) return null;

  const minimize = () =>
    getWindow()
      ?.minimize()
      .catch(() => {});
  const toggleMaximize = () =>
    getWindow()
      ?.toggleMaximize()
      .catch(() => {});
  const close = () =>
    getWindow()
      ?.close()
      .catch(() => {});

  return (
    <div
      className={cx(wc.controls, flush ? wc.flush : wc.inset)}
      // Swallow double-clicks so rapid clicking two buttons can't bubble into
      // any ancestor drag-region double-click → maximize toggle.
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button className={wc.btn} title="Minimize" aria-label="Minimize window" onClick={minimize}>
        <Minus size={13} />
      </button>
      <button
        className={wc.btn}
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        onClick={toggleMaximize}
      >
        {maximized ? <Copy size={11} /> : <Square size={11} />}
      </button>
      <button
        className={cx(wc.btn, wc.close)}
        title="Close"
        aria-label="Close window"
        onClick={close}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ── Styles: Windows/Linux caption buttons ───────────────────────────────── */

const wc = {
  controls: css`
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    user-select: none;
  `,
  flush: css`
    align-self: stretch;
    height: 100%;
    margin-left: 10px;
  `,
  inset: css`
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    overflow: hidden;
    height: 32px;
    margin-left: 10px;
  `,
  btn: css`
    width: 42px;
    height: 100%;
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
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    &:active {
      background: var(--bg-active);
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
