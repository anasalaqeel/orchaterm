import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Boot the keyboard manager (registers the single capture-phase listener) ───
// Import triggers module execution — the listener attaches once at startup so
// every registerShortcut() call in components shares the same handler.
import { registerShortcut } from './services/keyboardManager';

// ── Block WebView2/browser shortcuts when terminal is focused ─────────────────
// context: 'terminal-only' → only fires when an xterm instance has focus.
// keyboardManager calls e.preventDefault() before invoking the handler, which
// blocks the browser's built-in action (DevTools, reload, etc.) while xterm
// still receives the keystroke because preventDefault does not stop propagation.
//
// Shortcuts blocked when terminal is focused:
//   F12, Ctrl+Shift+I/C/J  — DevTools (Windows/Linux)
//   Cmd+Option+I            — DevTools (macOS)
//   Ctrl/Cmd+R              — Page reload (would destroy all PTY sessions)
//   Ctrl/Cmd+F/U/P          — Find / view-source / print (useless in terminal)

const noop = () => {};

const TERMINAL_BLOCKED: Array<{
  key: string; ctrl?: boolean; shift?: boolean; alt?: boolean;
}> = [
  // DevTools — Windows/Linux
  { key: 'F12' },
  { key: 'i', ctrl: true, shift: true },
  { key: 'c', ctrl: true, shift: true },
  { key: 'j', ctrl: true, shift: true },
  // DevTools — macOS (Cmd+Option+I)
  { key: 'i', ctrl: true, alt: true },
  // Page reload
  { key: 'r', ctrl: true },
  // Find in page / view-source / print
  { key: 'f', ctrl: true },
  { key: 'u', ctrl: true },
  { key: 'p', ctrl: true },
];

for (const def of TERMINAL_BLOCKED) {
  registerShortcut({ ...def, context: 'terminal-only', handler: noop });
}

// NOTE: React.StrictMode is intentionally omitted. StrictMode double-invokes
// useEffect in development, which causes every TerminalTab to spawn, kill, and
// re-spawn its PTY process. With N saved tabs that means 2N PowerShell processes
// starting simultaneously — each taking 1–3 s on Windows — which freezes the app
// for several seconds on startup. PTY processes are external OS resources that
// cannot be cheaply re-created, so the StrictMode "run cleanup → re-run effect"
// cycle provides no benefit here and only causes visible freezing.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
