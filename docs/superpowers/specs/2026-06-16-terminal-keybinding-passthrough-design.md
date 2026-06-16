# Terminal Keybinding Passthrough — Design

**Date:** 2026-06-16
**Status:** Approved
**Author:** Anas Alaqeel

## Problem

Terminal keyboard shortcuts behave inconsistently. Two disjoint keyboard
systems fight each other:

1. **`src/services/keyboardManager.ts`** — a single document capture-phase
   `keydown` listener. When a registered shortcut matches it calls
   `e.preventDefault()` **only**. It never stops propagation, so xterm's own
   textarea `keydown` handler still fires afterward and forwards the key to the
   PTY. Result: `global`-context shortcuts (zoom `Ctrl +/-/0` in `App.tsx`)
   **double-fire** — they run the app action *and* leak the keystroke to the
   shell.

2. **`TerminalTab.attachCustomKeyEventHandler`** (`src/components/terminal/TerminalTab.tsx`) —
   a separate decision path. It hardcodes `ctrl+shift+c`, `ctrl+shift+v`, and
   `ctrl+l` fallbacks that override user config and cannot be removed. `ctrl+l`
   calls `term.clear()` instead of letting the shell redraw natively.

There is no single authority, no way to make the terminal pass an arbitrary
combination through to the shell, and no way to *unbind* a reserved chord.
This does not match how real terminal apps (Windows Terminal, VS Code
integrated terminal, iTerm2) behave: a small explicit reserved set, everything
else forwarded to the PTY, reserved keys fully consumed.

## Goal

When a terminal has focus it should intercept **any** keyboard combination and
forward it to the PTY by default — like a standard terminal emulator. Only an
explicit, user-configurable set of chords may be reserved for app/terminal
actions, and any reserved chord can be forced back to the shell via a
`passthrough` override.

## Decisions (confirmed with user)

- **Default behavior:** full passthrough. Out of the box nothing is reserved
  while the terminal is focused; every key goes to the PTY. Copy/paste happens
  via mouse, the existing floating Copy button, and middle-click paste.
- **Configurability:** the engine supports a keybinding table. The default
  table ships effectively empty (no terminal action bindings), so the default
  experience is pure passthrough. Users may add action bindings and a
  `passthrough` override in Settings.
- **Platform:** Windows-first, mac-safe. Keep `ctrl || meta` matching; no
  mac-specific default bindings in this iteration.

## Accepted trade-offs

- Zoom `Ctrl +/-/0` will **not** work while a terminal is focused — those keys
  pass through to the shell. Zoom still works everywhere else in the app.
- `Ctrl+L` reaches the shell (native redraw) instead of calling
  `term.clear()`.
- DevTools shortcuts (`F12`, `Ctrl+Shift+I/J/C`, `Cmd+Opt+I`) remain blocked
  and consumed — the single intentional exception — to prevent the WebView2
  developer tools from hijacking focus mid-typing. These stay configurable to
  remove in a later iteration but are kept on by default.

## Architecture

### Single authority: the terminal key resolver

When an xterm instance has focus, its `attachCustomKeyEventHandler` is the sole
decision point. The resolution logic is extracted into a **pure function** so it
can be unit-tested in isolation:

```ts
// src/utils/terminalThemes.ts (or a new src/utils/terminalKeybindings.ts)
type ResolvedAction = TerminalKeybinding['action'];

function resolveTerminalKey(
  combo: string,
  keybindings: TerminalKeybinding[],
): TerminalKeybinding | null;
```

- Returns the matching `TerminalKeybinding` or `null`.
- No match → `null`.

`attachCustomKeyEventHandler` flow (keydown only):

1. `combo = buildCombo(e)`
2. `binding = resolveTerminalKey(combo, terminalConfig.keybindings)`
3. `binding == null` → `return true` → **xterm forwards the key to the PTY**
   (this is the default for every unconfigured combination).
4. `binding.action === 'passthrough'` → `return true` (force to shell, explicit
   override — do not run any action).
5. otherwise run the action (`copy` / `paste` / `clear` / `scroll-top` /
   `scroll-bottom` / `send-text`) and `return false` (consume, do not send to
   PTY).

The hardcoded `ctrl+shift+c` / `ctrl+shift+v` / `ctrl+l` fallback block is
**removed**.

### keyboardManager becomes terminal-silent

The manager keeps its single capture-phase listener but stops eating keys that
belong to the terminal:

- **Add `e.stopImmediatePropagation()`** (alongside the existing
  `e.preventDefault()`) when a shortcut fires. A consumed key then never reaches
  xterm's textarea handler, eliminating every double-fire path.
- **Reclassify zoom** in `src/App.tsx` from `context: 'global'` to
  `context: 'non-terminal'` so zoom keys are not consumed while a terminal is
  focused and instead reach the shell.
- **Keep DevTools blockers** (`src/main.tsx`, `context: 'terminal-only'`) — the
  one intentional exception. With `stopImmediatePropagation` they are now fully
  consumed instead of also leaking to the PTY.
- `QuickSwitcher` `Ctrl+K` is already `context: 'non-terminal'`, so `ctrl+k`
  correctly reaches the shell (readline kill-line) while a terminal is focused.
  No change needed. Its modal-navigation bindings (Escape/Arrows/Enter,
  registered only while the modal is open) are unaffected because the modal
  input holds focus.

### Defaults → pure passthrough

`DEFAULT_TERMINAL_CONFIG.keybindings` in `src/utils/terminalThemes.ts` drops the
`{ key: 'ctrl+l', action: 'clear' }` entry and ships as `[]`. Out of the box the
terminal reserves nothing.

### Types

Add `'passthrough'` to the action union in `src/types/terminal.types.ts`:

```ts
action: 'clear' | 'scroll-top' | 'scroll-bottom' | 'send-text'
      | 'copy' | 'paste' | 'passthrough';
```

`passthrough` ignores the `text` field.

### Settings UI

`src/pages/Settings.tsx` already renders an add/remove keybinding editor.
Add `'passthrough'` to the action dropdown options. No other UI restructuring.

## Data flow (terminal focused)

```
keydown on xterm textarea
  │
  ├─ document capture: keyboardManager
  │     match? → preventDefault + stopImmediatePropagation + handler   [STOP]
  │     no match → falls through
  │
  └─ xterm textarea keydown → attachCustomKeyEventHandler
        resolveTerminalKey(combo, keybindings)
          null            → return true  → onData → write_pty
          passthrough     → return true  → onData → write_pty
          action          → run action   → return false (no PTY)
```

## Components and responsibilities

- **`resolveTerminalKey` (pure util)** — maps a combo string + keybinding list
  to an action or null. No DOM, no side effects. Unit-tested.
- **`TerminalTab.attachCustomKeyEventHandler`** — adapts a `KeyboardEvent` to a
  combo, calls the resolver, performs the side effects (clipboard, `write_pty`,
  scroll, clear) for matched actions, returns the xterm pass/consume boolean.
- **`keyboardManager`** — owns app-level (non-terminal/global) chords only;
  fully consumes what it handles.

## Error handling

- Clipboard reads/writes already guard `navigator.clipboard` and `.catch(() =>
  {})`; preserved.
- `write_pty` invocations keep their existing `.catch` handlers.
- `resolveTerminalKey` returns `null` for any unrecognized or malformed combo —
  the safe default (pass to shell).

## Testing

- Extend `src/tests/terminalThemes.test.ts` (or a new test file) with
  `resolveTerminalKey` cases:
  - empty keybindings → `null` for any combo (pure passthrough default).
  - configured action combo → returns that binding.
  - `passthrough` binding → returns binding with `action: 'passthrough'`.
  - non-matching combo with a populated table → `null`.
- Existing `buildCombo` tests remain valid.
- Manual smoke: with default config, verify `Ctrl+R` (reverse search),
  `Ctrl+L` (clear/redraw), `Ctrl+K`, `Ctrl+U`, `Ctrl+A/E`, `Ctrl +/-` all reach
  the shell; verify DevTools stays blocked; verify a configured `copy` binding
  consumes and copies.

## Out of scope

- mac-specific default keybindings.
- Removing the DevTools block by default.
- Reworking the Settings keybinding editor beyond adding the new action option.
