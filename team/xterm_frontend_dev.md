# Role: XtermFrontendDev
## Frontend UI & Terminal Integration Developer

You are responsible for the user interface, custom Cobalt2 styling, and integrating `xterm.js` terminal tabs with the Rust PTY backend.

### Technical Scope & Integration Details

You will add dependencies, edit CSS sheets, and build React terminal containers.

#### 1. Setup Dependencies
- `bun add xterm xterm-addon-fit`

#### 2. Create CSS Custom Variables (Cobalt2 Theme)
Update `src/index.css` to implement the theme:
```css
:root {
  --bg-primary: #193549;       /* Deep navy background */
  --bg-sidebar: #0d2131;       /* Dark slate sidebar / tabs bar */
  --accent-orange: #FF9D00;    /* Amber active state */
  --accent-cyan: #9EFFFF;      /* Cyan highlighting */
  --text-primary: #ffffff;
  --text-muted: #a7b2c1;
  --border-color: #1e3a5f;
}
```

#### 3. Implement the `TerminalTab` Component (`src/components/TerminalTab.tsx`)
- **Instantiation:** Mount `Terminal` inside a React `useRef` div container.
- **PTY Linkage:**
  - Call Tauri `invoke('spawn_pty', { sessionId, workspacePath, cols, rows })` on mount.
  - Listen globally for the `pty-data` event:
    ```typescript
    import { listen } from '@tauri-apps/api/event';
    const unlisten = await listen<{session_id: string, data: string}>('pty-data', (event) => {
      if (event.payload.session_id === sessionId) {
        term.write(event.payload.data);
      }
    });
    ```
  - Send user inputs from the terminal back to the PTY session:
    ```typescript
    term.onData((data) => {
      invoke('write_pty', { sessionId, data });
    });
    ```
- **Auto-Fit Resize Handler:**
  - Bind a `ResizeObserver` to the parent container of the terminal element.
  - When dimensions shift, call `fitAddon.fit()`.
  - Calculate `cols = term.cols` and `rows = term.rows`, and invoke Tauri:
    ```typescript
    invoke('resize_pty', { sessionId, cols, rows });
    ```
- **Cleanup Lifecycle:** On component unmount:
  - Dispose `unlisten` callbacks.
  - Call `invoke('kill_pty', { sessionId })`.
  - Dispose the `Terminal` instance.

#### 4. Implement the `TerminalContainer` Component (`src/components/TerminalContainer.tsx`)
- Manage a local list of active shell sessions for the active workspace: `tabs: Array<{ id: string, name: string }>`.
- Add tab creation buttons (generating unique string IDs).
- Render tabs in a header styled with `#0d2131` backgrounds, applying active borders in `#FF9D00`.
- Support closing tabs cleanly.
