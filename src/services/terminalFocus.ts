// ── Terminal Focus Tracker ─────────────────────────────────────────────────────
// Reports whether an xterm instance currently has keyboard focus by inspecting
// the live DOM. This replaced a focus/blur event counter that could desync
// (e.g. an unmounting terminal firing blur *and* a manual decrement), which
// once caused app shortcuts to fire while a terminal was actually focused.
//
// Querying `document.activeElement` is the ground truth and can never drift —
// no registration/unregistration needed, and no state to corrupt on unmount.

/**
 * True when an xterm instance currently has keyboard focus.
 *
 * xterm captures input through a hidden `<textarea class="xterm-helper-textarea">`
 * (stable across xterm 5.x). When the terminal is focused that element is
 * `document.activeElement`; clicking away moves focus elsewhere, so this check
 * always reflects reality.
 */
export function isTerminalFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  return (
    !!el &&
    el.tagName === 'TEXTAREA' &&
    el.classList.contains('xterm-helper-textarea')
  );
}
