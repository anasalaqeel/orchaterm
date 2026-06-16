// ── Centralized Keyboard Manager ──────────────────────────────────────────────
// Single capture-phase listener on document. Replaces scattered
// window.addEventListener('keydown') calls across the app.
//
// Context:
//   'global'         — always fires, regardless of focus
//   'non-terminal'   — skipped when a terminal has focus (app shortcuts)
//   'terminal-only'  — only fires when a terminal has focus (browser-default blocking)
//
// Usage:
//   const remove = registerShortcut({
//     key: 'k', ctrl: true,
//     context: 'non-terminal',
//     handler: () => openSwitcher(),
//   });
//   // call remove() in useEffect cleanup

import { isTerminalFocused } from './terminalFocus';

export type ShortcutContext = 'global' | 'non-terminal' | 'terminal-only';

export interface Shortcut {
  key: string;
  /** Matches e.ctrlKey || e.metaKey */
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  context: ShortcutContext;
  handler: (e: KeyboardEvent) => void;
}

const registry: Shortcut[] = [];

function matches(s: Shortcut, e: KeyboardEvent): boolean {
  return (
    s.key.toLowerCase() === e.key.toLowerCase() &&
    !!s.ctrl  === (e.ctrlKey || e.metaKey) &&
    !!s.shift === e.shiftKey &&
    !!s.alt   === e.altKey
  );
}

document.addEventListener(
  'keydown',
  (e: KeyboardEvent) => {
    const termFocused = isTerminalFocused();

    for (const s of registry) {
      if (s.context === 'non-terminal'  && termFocused)  continue;
      if (s.context === 'terminal-only' && !termFocused) continue;
      if (!matches(s, e)) continue;
      // Fully consume the key: preventDefault blocks the browser/WebView default
      // action, stopImmediatePropagation stops the event before it reaches
      // xterm's textarea keydown handler — otherwise the keystroke would also be
      // forwarded to the PTY (double-fire). With this, a reserved app chord never
      // leaks to the shell, and any key NOT in the registry falls through
      // untouched so the terminal can forward it.
      e.preventDefault();
      e.stopImmediatePropagation();
      s.handler(e);
    }
  },
  { capture: true },
);

/**
 * Register a keyboard shortcut. Returns a cleanup function — call it in
 * useEffect's return or on component unmount.
 */
export function registerShortcut(shortcut: Shortcut): () => void {
  registry.push(shortcut);
  return () => {
    const i = registry.indexOf(shortcut);
    if (i >= 0) registry.splice(i, 1);
  };
}
