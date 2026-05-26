// ── Terminal Focus Tracker ─────────────────────────────────────────────────────
// Tracks how many xterm instances currently have focus.
// TerminalTab registers via terminalGainedFocus / terminalLostFocus
// using xterm's onFocus / onBlur callbacks — no DOM traversal needed.

let focusedCount = 0;

export function terminalGainedFocus(): void {
  focusedCount++;
}

export function terminalLostFocus(): void {
  focusedCount = Math.max(0, focusedCount - 1);
}

/** True when at least one xterm instance currently has keyboard focus. */
export function isTerminalFocused(): boolean {
  return focusedCount > 0;
}
