import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// ── WebdriverIO E2E bridge ────────────────────────────────────────────────────
// Only activated in E2E builds (vite --mode e2e, see e2e/wdio.conf.ts and
// src-tauri/tauri.e2e.conf.json). The dynamic import is tree-shaken out of
// dev/production builds, which never load the test bridge. The sandbox reset
// gives every E2E boot a clean chat history and an expanded chat panel.
if (import.meta.env.MODE === 'e2e') {
  localStorage.clear();
  localStorage.setItem('orchaterm:chatCollapsed', 'false');
  import('@wdio/tauri-plugin');
}

// ── Boot the keyboard manager (registers the single capture-phase listener) ───
// Import triggers module execution — the listener attaches once at startup so
// every registerShortcut() call in components shares the same handler.
import { registerShortcut } from './services/keyboardManager';

// ── Block WebView2/browser shortcuts when terminal is focused ─────────────────
// context: 'terminal-only' → only fires when an xterm instance has focus.
// keyboardManager calls e.preventDefault() before invoking the handler, which
// blocks the browser's built-in action (DevTools) while xterm
// still receives the keystroke because preventDefault does not stop propagation.
//
// We only block DevTools here. Native shell shortcuts like Ctrl+R, Ctrl+C, Ctrl+U
// are NOT blocked here, so xterm can natively process them and send them to the PTY.

const noop = () => {};

const TERMINAL_BLOCKED: Array<{
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}> = [
  // DevTools — Windows/Linux
  { key: 'F12' },
  { key: 'i', ctrl: true, shift: true },
  { key: 'j', ctrl: true, shift: true },
  // DevTools — macOS (Cmd+Option+I)
  { key: 'i', ctrl: true, alt: true },
  // NOTE: Ctrl+Shift+C (Chromium "inspect element") is intentionally NOT blocked
  // here — it is the terminal copy chord. The terminal's key handler consumes it
  // (returns false → xterm cancels the event), so DevTools still never opens.
];

for (const def of TERMINAL_BLOCKED) {
  registerShortcut({ ...def, context: 'terminal-only', handler: noop });
}

// ── Block unhandled Escape from triggering macOS native fullscreen exit ────────
// On macOS WKWebView, an unprevented Escape keydown event bubbles to NSWindow,
// which invokes cancelOperation: and exits fullscreen mode by default.
// In terminal and developer applications, Escape is an editing/navigation key, never
// a window control shortcut (native macOS fullscreen toggle is Cmd+Ctrl+F).
// Handlers that consume Escape call preventDefault() locally; this bubble-phase
// catch-all ensures that even when focus is on a non-input element (e.g. sidebar,
// background), pressing Escape will not unexpectedly drop the app out of fullscreen.
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
    }
  });
}

// NOTE: React.StrictMode is intentionally omitted. StrictMode double-invokes
// useEffect in development, which causes every TerminalTab to spawn, kill, and
// re-spawn its PTY process. With N saved tabs that means 2N PowerShell processes
// starting simultaneously — each taking 1–3 s on Windows — which freezes the app
// for several seconds on startup. PTY processes are external OS resources that
// cannot be cheaply re-created, so the StrictMode "run cleanup → re-run effect"
// cycle provides no benefit here and only causes visible freezing.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
