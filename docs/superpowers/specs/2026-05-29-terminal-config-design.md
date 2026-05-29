# Terminal Configuration System — Design Spec
**Date:** 2026-05-29  
**Status:** Approved

## Overview

Add a global terminal configuration system to Orchaterm. End users configure appearance (colors/theme, fonts, cursor), behavior (scrollback, macOptionIsMeta), and keybindings via the existing Settings UI Terminal tab. Config is stored in `AppSettings` and applied live to all xterm.js terminal instances.

---

## Architecture

### New Types (`src/types/terminal.types.ts`)

```typescript
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  brightBlack: string;
  red: string;
  brightRed: string;
  green: string;
  brightGreen: string;
  yellow: string;
  brightYellow: string;
  blue: string;
  brightBlue: string;
  magenta: string;
  brightMagenta: string;
  cyan: string;
  brightCyan: string;
  white: string;
  brightWhite: string;
}

export interface TerminalKeybinding {
  key: string;       // e.g. "ctrl+k"
  action: 'clear' | 'scroll-top' | 'scroll-bottom' | 'send-text';
  text?: string;     // only for 'send-text' action
}

export interface TerminalConfig {
  theme: TerminalTheme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  scrollback: number;
  macOptionIsMeta: boolean;
  keybindings: TerminalKeybinding[];
}
```

`DEFAULT_TERMINAL_CONFIG` mirrors the current hardcoded values in `TerminalTab.tsx:142–180` so no visual change on first load after update.

### AppSettings Extension (`src/types/workspace.types.ts`)

Add `terminalConfig: TerminalConfig` to `AppSettings`. `DashboardContext` applies `DEFAULT_TERMINAL_CONFIG` when field is missing (backward-compatible migration on first load).

### Data Flow

```
Settings UI → updateSettings({ terminalConfig }) → save_store (Tauri)
                                                         ↓
DashboardContext.settings.terminalConfig
                    ↓
TerminalTab.tsx — constructor options + live useEffect
```

---

## Settings UI (`src/pages/Settings.tsx`)

Terminal tab expanded with 5 sections below existing Shell section. Single **Save Terminal Settings** button at bottom saves all sections.

### 1. Colors & Theme
- Preset theme cards (click to apply): Default, Dracula, Tokyo Night, Nord, Gruvbox Dark, One Dark, Solarized Dark, Catppuccin Mocha
- "Custom" card expands a color grid with `<input type="color">` for all 18 slots: background, foreground, cursor, cursorAccent, selectionBackground, selectionForeground, plus the 12 ANSI color pairs

### 2. Font
- Text input: font family (comma-separated, e.g. `"Fira Code", monospace`)
- Number input: font size (px, min 8, max 32)
- Slider + number: line height (0.8–2.0, step 0.1)
- Number input: letter spacing (px, min -2, max 10)

### 3. Cursor
- 3-button toggle: `█ Block` / `▁ Underline` / `| Bar`
- Checkbox/toggle: cursor blink

### 4. Behavior
- Number input: scrollback lines (min 100, max 100000)
- Toggle: macOptionIsMeta (Option key acts as Meta on macOS)

### 5. Keybindings
- Table columns: Key combo | Action | Text (if send-text) | Delete
- "Add binding" row: key combo text input + action `<select>` (`clear`, `scroll-top`, `scroll-bottom`, `send-text`) + optional text input
- Rows editable inline

---

## TerminalTab Live Updates (`src/components/terminal/TerminalTab.tsx`)

### Constructor
Pass full `terminalConfig` to `new Terminal({...})` replacing all hardcoded values.

### Live Update Effect
Second `useEffect` (deps: `[terminalConfig]`, runs after mount):
```typescript
useEffect(() => {
  const term = termRef.current;
  if (!term) return;
  term.options.theme = terminalConfig.theme;
  term.options.fontSize = terminalConfig.fontSize;
  term.options.fontFamily = terminalConfig.fontFamily;
  term.options.lineHeight = terminalConfig.lineHeight;
  term.options.letterSpacing = terminalConfig.letterSpacing;
  term.options.cursorStyle = terminalConfig.cursorStyle;
  term.options.cursorBlink = terminalConfig.cursorBlink;
  term.options.scrollback = terminalConfig.scrollback;
  term.options.macOptionIsMeta = terminalConfig.macOptionIsMeta;
  // Re-fit after font changes so cell dimensions recalculate
  if (fitAddonRef.current) safeFit(fitAddonRef.current);
}, [terminalConfig]);
```

### Keybinding Handler
```typescript
useEffect(() => {
  const term = termRef.current;
  if (!term) return;
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (e.type !== 'keydown') return true;
    const combo = buildCombo(e); // e.g. "ctrl+k"
    const binding = terminalConfig.keybindings.find(b => b.key === combo);
    if (!binding) return true;
    switch (binding.action) {
      case 'clear':         term.clear(); break;
      case 'scroll-top':    term.scrollToTop(); break;
      case 'scroll-bottom': term.scrollToBottom(); break;
      case 'send-text':     invoke('write_pty', { sessionId, data: binding.text ?? '' }); break;
    }
    return false; // prevent xterm default
  });
}, [terminalConfig.keybindings, sessionId]);
```

---

## Preset Theme Definitions

Each preset is a hardcoded `TerminalTheme` constant. Defined in a new file `src/utils/terminalThemes.ts` and imported by `Settings.tsx`.

Presets: Default (current dark), Dracula, Tokyo Night, Nord, Gruvbox Dark, One Dark, Solarized Dark, Catppuccin Mocha.

---

## Files Changed

| File | Change |
|------|--------|
| `src/types/terminal.types.ts` | Add `TerminalTheme`, `TerminalKeybinding`, `TerminalConfig` |
| `src/types/workspace.types.ts` | Add `terminalConfig: TerminalConfig` to `AppSettings` |
| `src/utils/terminalThemes.ts` | New — preset theme constants + `DEFAULT_TERMINAL_CONFIG` |
| `src/context/DashboardContext.tsx` | Migration: apply default when `terminalConfig` missing |
| `src/components/terminal/TerminalTab.tsx` | Read config from context, add live-update effect, add keybinding effect |
| `src/pages/Settings.tsx` | Expand Terminal tab with 5 new sections |

---

## Migration

`DashboardContext` on load: if `settings.terminalConfig` is `undefined`, merge `DEFAULT_TERMINAL_CONFIG` into settings before writing to state. No user action required. No data loss.

---

## Out of Scope

- Per-workspace or per-tab config overrides
- SSH/domain config (WezTerm-specific, no equivalent in xterm.js)
- Tab/pane splitting config (handled separately by existing split layout system)
- Window decoration / padding (Tauri window config, separate concern)
