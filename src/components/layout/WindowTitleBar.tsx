/*
 * WindowTitleBar.tsx
 *
 * Full-width strip at the very top of the window for Windows/Linux caption
 * buttons — `decorations: false` there means the native frame is off, so
 * this replaces it, right-aligned like a normal Windows title bar. Mounted
 * once, in AppLayout, above the <Sidebar>/<main> row (rather than
 * duplicated per-page).
 *
 * Renders nothing on macOS: `src-tauri/tauri.macos.conf.json` re-enables
 * `decorations: true` there instead, so the OS draws a real native title
 * bar (traffic lights, app title, fullscreen support) above the webview,
 * entirely outside this component's control. That's a deliberate choice,
 * not the default — `titleBarStyle: "Overlay"` (content extending under
 * real traffic lights, VS Code-style, so this bar could stay unified across
 * platforms) is broken on macOS 26 Tahoe: a Rust debug print confirmed
 * Tauri resolves `title_bar_style=Overlay` correctly, yet the live window
 * still draws a full opaque titlebar — matching community reports of
 * Tahoe's AppKit changes breaking Overlay in current tao/Tauri. A
 * hand-drawn traffic-light fallback was tried too, but the plain native
 * titlebar wins on both counts that matter: it looks like any other macOS
 * app, and it's the only option that supports real fullscreen — borderless
 * windows (what `decorations: false` produces) can't enter native
 * fullscreen at all on macOS, confirmed by testing the Toggle Full Screen
 * menu item and Cmd+Ctrl+F on the hand-drawn version; neither did anything.
 *
 * The whole bar is a drag region (native frame is off on Windows/Linux);
 * WindowControls' own buttons opt back out via their own event handling so
 * they stay clickable.
 */
import { css } from '@emotion/css';
import { WindowControls } from './WindowControls';
import { isMacOS } from '../../utils/platform';

export function WindowTitleBar() {
  if (isMacOS) return null;
  return (
    <div className={s.bar} data-tauri-drag-region>
      <WindowControls />
    </div>
  );
}

const s = {
  bar: css`
    height: 38px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    user-select: none;
  `,
};
