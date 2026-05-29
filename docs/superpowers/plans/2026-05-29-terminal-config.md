# Terminal Configuration System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global terminal configuration system (colors, fonts, cursor, behavior, keybindings) that end users configure via the Settings UI Terminal tab, applied live to all xterm.js terminal instances.

**Architecture:** Extend `AppSettings` with a `terminalConfig: TerminalConfig` object. `migrateSettings()` in `DashboardContext.tsx` fills in the default on first load. `TerminalTab` reads config from `useDashboard()` and applies it at construction time plus via a live-update `useEffect`. `Settings.tsx` Terminal tab expands with five new cards.

**Tech Stack:** React, TypeScript, xterm.js (`Terminal` options API + `attachCustomKeyEventHandler`), `@emotion/css`, Tauri (`invoke`)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/terminal.types.ts` | Modify | Add `TerminalTheme`, `TerminalKeybinding`, `TerminalConfig` types |
| `src/types/workspace.types.ts` | Modify | Add `terminalConfig?: TerminalConfig` to `AppSettings` |
| `src/utils/terminalThemes.ts` | **Create** | Preset themes, `DEFAULT_TERMINAL_CONFIG`, `buildCombo` utility |
| `src/utils/index.ts` | Modify | Re-export from `terminalThemes.ts` |
| `src/tests/terminalThemes.test.ts` | **Create** | Unit tests for `buildCombo` |
| `src/context/DashboardContext.tsx` | Modify | Add `terminalConfig` to `migrateSettings()` return + initial state |
| `src/components/terminal/TerminalTab.tsx` | Modify | Read config from context; live-update + keybinding effects |
| `src/pages/Settings.tsx` | Modify | Expand Terminal tab: Colors, Font, Cursor, Behavior, Keybindings cards |

---

### Task 1: Add terminal config types

**Files:**
- Modify: `src/types/terminal.types.ts`
- Modify: `src/types/workspace.types.ts`

- [ ] **Step 1: Append new types to `src/types/terminal.types.ts`**

After the closing `}` of the existing `TerminalSession` interface, add:

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
  /** Combo string e.g. "ctrl+k", "ctrl+shift+t". Lowercase, modifiers first. */
  key: string;
  action: 'clear' | 'scroll-top' | 'scroll-bottom' | 'send-text';
  /** Only used when action === 'send-text'. */
  text?: string;
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

- [ ] **Step 2: Add import + field to `AppSettings` in `src/types/workspace.types.ts`**

Add import at the very top of the file (before the existing `UseCaseProviders` import):

```typescript
import type { TerminalConfig } from './terminal.types';
```

Inside the `AppSettings` interface, add `terminalConfig` after `llmProviders`:

```typescript
export interface AppSettings {
  shellPath: string;
  conductorTaskTimeoutMinutes: number;
  conductorInteractionMode: 'auto' | 'manual';
  llmProviders: UseCaseProviders;
  terminalConfig?: TerminalConfig;
  // ── Legacy fields kept for one-time migration on first load ──────────────
  ollamaHost?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  conductorOllamaModel?: string;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```
bun run tsc --noEmit
```

Expected: no errors — `terminalConfig` is optional so all existing code is unaffected.

- [ ] **Step 4: Commit**

```
git add src/types/terminal.types.ts src/types/workspace.types.ts
git commit -m "feat(types): add TerminalTheme, TerminalKeybinding, TerminalConfig"
```

---

### Task 2: Create `src/utils/terminalThemes.ts`

**Files:**
- Create: `src/utils/terminalThemes.ts`
- Modify: `src/utils/index.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { TerminalConfig, TerminalTheme } from '../types';

export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  theme: {
    background: '#0C0C0C',
    foreground: '#d4d4d4',
    cursor: '#7B68EE',
    cursorAccent: '#0C0C0C',
    selectionBackground: 'rgba(158, 255, 255, 0.25)',
    selectionForeground: '#ffffff',
    black: '#1a1a1a',
    brightBlack: '#4a4a4a',
    red: '#ff6262',
    brightRed: '#ff8080',
    green: '#3ad900',
    brightGreen: '#57ff1a',
    yellow: '#ffc56f',
    brightYellow: '#ffd699',
    blue: '#4db8ff',
    brightBlue: '#80ccff',
    magenta: '#ff76ff',
    brightMagenta: '#ffaaff',
    cyan: '#9ed9ff',
    brightCyan: '#c2e9ff',
    white: '#d4d4d4',
    brightWhite: '#ffffff',
  },
  fontFamily: "'Fira Code', 'Cascadia Code', Consolas, Monaco, 'Courier New', monospace",
  fontSize: 13,
  lineHeight: 1.4,
  letterSpacing: 0,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
  macOptionIsMeta: true,
  keybindings: [],
};

export interface ThemePreset {
  name: string;
  theme: TerminalTheme;
}

export const TERMINAL_THEME_PRESETS: ThemePreset[] = [
  { name: 'Default', theme: DEFAULT_TERMINAL_CONFIG.theme },
  {
    name: 'Dracula',
    theme: {
      background: '#282a36', foreground: '#f8f8f2',
      cursor: '#f8f8f2', cursorAccent: '#282a36',
      selectionBackground: 'rgba(255,121,198,0.3)', selectionForeground: '#f8f8f2',
      black: '#21222c', brightBlack: '#6272a4',
      red: '#ff5555', brightRed: '#ff6e6e',
      green: '#50fa7b', brightGreen: '#69ff94',
      yellow: '#f1fa8c', brightYellow: '#ffffa5',
      blue: '#bd93f9', brightBlue: '#d6acff',
      magenta: '#ff79c6', brightMagenta: '#ff92df',
      cyan: '#8be9fd', brightCyan: '#a4ffff',
      white: '#f8f8f2', brightWhite: '#ffffff',
    },
  },
  {
    name: 'Tokyo Night',
    theme: {
      background: '#1a1b2e', foreground: '#c0caf5',
      cursor: '#c0caf5', cursorAccent: '#1a1b2e',
      selectionBackground: 'rgba(65,72,104,0.5)', selectionForeground: '#c0caf5',
      black: '#15161e', brightBlack: '#414868',
      red: '#f7768e', brightRed: '#ff899d',
      green: '#9ece6a', brightGreen: '#b9f27c',
      yellow: '#e0af68', brightYellow: '#ffc777',
      blue: '#7aa2f7', brightBlue: '#82aaff',
      magenta: '#bb9af7', brightMagenta: '#c0a9f7',
      cyan: '#7dcfff', brightCyan: '#b4f9f8',
      white: '#a9b1d6', brightWhite: '#c0caf5',
    },
  },
  {
    name: 'Nord',
    theme: {
      background: '#2e3440', foreground: '#d8dee9',
      cursor: '#d8dee9', cursorAccent: '#2e3440',
      selectionBackground: 'rgba(67,76,94,0.5)', selectionForeground: '#d8dee9',
      black: '#3b4252', brightBlack: '#4c566a',
      red: '#bf616a', brightRed: '#c6757e',
      green: '#a3be8c', brightGreen: '#b3ce9d',
      yellow: '#ebcb8b', brightYellow: '#f0d49c',
      blue: '#81a1c1', brightBlue: '#92b4d0',
      magenta: '#b48ead', brightMagenta: '#c39fbe',
      cyan: '#88c0d0', brightCyan: '#9dced9',
      white: '#e5e9f0', brightWhite: '#eceff4',
    },
  },
  {
    name: 'Gruvbox Dark',
    theme: {
      background: '#282828', foreground: '#ebdbb2',
      cursor: '#ebdbb2', cursorAccent: '#282828',
      selectionBackground: 'rgba(80,73,69,0.5)', selectionForeground: '#ebdbb2',
      black: '#282828', brightBlack: '#928374',
      red: '#cc241d', brightRed: '#fb4934',
      green: '#98971a', brightGreen: '#b8bb26',
      yellow: '#d79921', brightYellow: '#fabd2f',
      blue: '#458588', brightBlue: '#83a598',
      magenta: '#b16286', brightMagenta: '#d3869b',
      cyan: '#689d6a', brightCyan: '#8ec07c',
      white: '#a89984', brightWhite: '#ebdbb2',
    },
  },
  {
    name: 'One Dark',
    theme: {
      background: '#282c34', foreground: '#abb2bf',
      cursor: '#528bff', cursorAccent: '#282c34',
      selectionBackground: 'rgba(67,76,94,0.5)', selectionForeground: '#abb2bf',
      black: '#282c34', brightBlack: '#5c6370',
      red: '#e06c75', brightRed: '#e06c75',
      green: '#98c379', brightGreen: '#98c379',
      yellow: '#e5c07b', brightYellow: '#e5c07b',
      blue: '#61afef', brightBlue: '#61afef',
      magenta: '#c678dd', brightMagenta: '#c678dd',
      cyan: '#56b6c2', brightCyan: '#56b6c2',
      white: '#abb2bf', brightWhite: '#ffffff',
    },
  },
  {
    name: 'Solarized Dark',
    theme: {
      background: '#002b36', foreground: '#839496',
      cursor: '#839496', cursorAccent: '#002b36',
      selectionBackground: 'rgba(7,54,66,0.5)', selectionForeground: '#839496',
      black: '#073642', brightBlack: '#002b36',
      red: '#dc322f', brightRed: '#cb4b16',
      green: '#859900', brightGreen: '#586e75',
      yellow: '#b58900', brightYellow: '#657b83',
      blue: '#268bd2', brightBlue: '#839496',
      magenta: '#d33682', brightMagenta: '#6c71c4',
      cyan: '#2aa198', brightCyan: '#93a1a1',
      white: '#eee8d5', brightWhite: '#fdf6e3',
    },
  },
  {
    name: 'Catppuccin Mocha',
    theme: {
      background: '#1e1e2e', foreground: '#cdd6f4',
      cursor: '#f5e0dc', cursorAccent: '#1e1e2e',
      selectionBackground: 'rgba(88,91,112,0.5)', selectionForeground: '#cdd6f4',
      black: '#45475a', brightBlack: '#585b70',
      red: '#f38ba8', brightRed: '#f38ba8',
      green: '#a6e3a1', brightGreen: '#a6e3a1',
      yellow: '#f9e2af', brightYellow: '#f9e2af',
      blue: '#89b4fa', brightBlue: '#89b4fa',
      magenta: '#cba6f7', brightMagenta: '#cba6f7',
      cyan: '#94e2d5', brightCyan: '#94e2d5',
      white: '#bac2de', brightWhite: '#a6adc8',
    },
  },
];

/**
 * Builds a normalized combo string from a KeyboardEvent.
 * Modifier order is always: ctrl → alt → shift → meta.
 * Examples: "ctrl+k", "ctrl+shift+t", "alt+b"
 */
export function buildCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey)  parts.push('ctrl');
  if (e.altKey)   parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (e.metaKey)  parts.push('meta');
  const key = e.key.toLowerCase();
  if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
    parts.push(key);
  }
  return parts.join('+');
}
```

- [ ] **Step 2: Re-export from `src/utils/index.ts`**

Replace the contents of `src/utils/index.ts` with:

```typescript
export { DEFAULT_TERMINAL_CONFIG, TERMINAL_THEME_PRESETS, buildCombo } from './terminalThemes';
export type { ThemePreset } from './terminalThemes';
```

- [ ] **Step 3: Verify TypeScript compiles**

```
bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```
git add src/utils/terminalThemes.ts src/utils/index.ts
git commit -m "feat(utils): add theme presets, DEFAULT_TERMINAL_CONFIG, buildCombo"
```

---

### Task 3: Unit tests for `buildCombo`

**Files:**
- Create: `src/tests/terminalThemes.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it, expect } from 'vitest';
import { buildCombo } from '../utils/terminalThemes';

function makeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: '',
    ...overrides,
  } as KeyboardEvent;
}

describe('buildCombo', () => {
  it('single modifier + letter', () => {
    expect(buildCombo(makeEvent({ ctrlKey: true, key: 'k' }))).toBe('ctrl+k');
  });

  it('multiple modifiers + letter', () => {
    expect(buildCombo(makeEvent({ ctrlKey: true, shiftKey: true, key: 't' }))).toBe('ctrl+shift+t');
  });

  it('alt + letter', () => {
    expect(buildCombo(makeEvent({ altKey: true, key: 'b' }))).toBe('alt+b');
  });

  it('modifier key only', () => {
    expect(buildCombo(makeEvent({ ctrlKey: true, key: 'Control' }))).toBe('ctrl');
  });

  it('no modifiers — bare key', () => {
    expect(buildCombo(makeEvent({ key: 'enter' }))).toBe('enter');
  });

  it('function key lowercased', () => {
    expect(buildCombo(makeEvent({ key: 'F5' }))).toBe('f5');
  });

  it('modifier order is canonical ctrl→alt→shift→meta', () => {
    expect(
      buildCombo(makeEvent({ shiftKey: true, ctrlKey: true, metaKey: true, key: 'p' }))
    ).toBe('ctrl+shift+meta+p');
  });
});
```

- [ ] **Step 2: Run tests — expect all to pass**

```
bun run test src/tests/terminalThemes.test.ts
```

Expected: 7 passing.

- [ ] **Step 3: Commit**

```
git add src/tests/terminalThemes.test.ts
git commit -m "test(utils): add buildCombo unit tests"
```

---

### Task 4: DashboardContext — add `terminalConfig` to migration + initial state

**Files:**
- Modify: `src/context/DashboardContext.tsx`

- [ ] **Step 1: Add import**

At the top of `src/context/DashboardContext.tsx`, add:

```typescript
import { DEFAULT_TERMINAL_CONFIG } from '../utils/terminalThemes';
```

- [ ] **Step 2: Update `migrateSettings` to include `terminalConfig`**

`migrateSettings` (line ~108) has two return paths. Add `terminalConfig` to both:

```typescript
function migrateSettings(raw: Partial<AppSettings>): AppSettings {
  if (raw.llmProviders) {
    return {
      shellPath: raw.shellPath ?? '',
      conductorTaskTimeoutMinutes: raw.conductorTaskTimeoutMinutes ?? 0,
      conductorInteractionMode: raw.conductorInteractionMode ?? 'auto',
      llmProviders: {
        relay:      raw.llmProviders.relay      ?? { ...DEFAULT_OLLAMA_CONFIG },
        planGen:    raw.llmProviders.planGen    ?? { ...DEFAULT_OLLAMA_CONFIG },
        autoAnswer: raw.llmProviders.autoAnswer ?? { ...DEFAULT_OLLAMA_CONFIG },
        chat:       raw.llmProviders.chat       ?? { ...DEFAULT_OLLAMA_CONFIG },
        routing:    raw.llmProviders.routing    ?? { ...DEFAULT_OLLAMA_CONFIG },
      },
      terminalConfig: raw.terminalConfig ?? DEFAULT_TERMINAL_CONFIG,
    };
  }

  const legacyConfig = {
    provider: 'ollama' as const,
    model: raw.conductorOllamaModel || 'llama3.2',
    baseUrl: raw.ollamaHost || 'http://localhost:11434',
  };
  return {
    shellPath: raw.shellPath ?? '',
    conductorTaskTimeoutMinutes: raw.conductorTaskTimeoutMinutes ?? 0,
    conductorInteractionMode: raw.conductorInteractionMode ?? 'auto',
    llmProviders: {
      relay:      { ...legacyConfig },
      planGen:    { ...legacyConfig },
      autoAnswer: { ...legacyConfig },
      chat:       { ...legacyConfig },
      routing:    { ...legacyConfig },
    },
    terminalConfig: raw.terminalConfig ?? DEFAULT_TERMINAL_CONFIG,
  };
}
```

- [ ] **Step 3: Add `terminalConfig` to the initial `settings` useState (line ~165)**

```typescript
const [settings, setSettings] = useState<AppSettings>({
  shellPath: '',
  conductorTaskTimeoutMinutes: 0,
  conductorInteractionMode: 'auto',
  llmProviders: {
    relay:      { ...DEFAULT_OLLAMA_CONFIG },
    planGen:    { ...DEFAULT_OLLAMA_CONFIG },
    autoAnswer: { ...DEFAULT_OLLAMA_CONFIG },
    chat:       { ...DEFAULT_OLLAMA_CONFIG },
    routing:    { ...DEFAULT_OLLAMA_CONFIG },
  },
  terminalConfig: DEFAULT_TERMINAL_CONFIG,
});
```

- [ ] **Step 4: Verify TypeScript compiles**

```
bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```
git add src/context/DashboardContext.tsx
git commit -m "feat(context): add terminalConfig to migrateSettings and initial state"
```

---

### Task 5: TerminalTab — consume config, live-update effect, keybinding effect

**Files:**
- Modify: `src/components/terminal/TerminalTab.tsx`

- [ ] **Step 1: Add imports**

At the top of `TerminalTab.tsx`, add:

```typescript
import { useDashboard } from '../../context/DashboardContext';
import { DEFAULT_TERMINAL_CONFIG, buildCombo } from '../../utils/terminalThemes';
```

- [ ] **Step 2: Read `terminalConfig` from context**

Inside the `TerminalTab` forwardRef component body, before any `useRef`/`useState`, add:

```typescript
const { settings } = useDashboard();
const terminalConfig = settings.terminalConfig ?? DEFAULT_TERMINAL_CONFIG;
```

- [ ] **Step 3: Replace hardcoded `new Terminal({...})` options**

The `new Terminal({...})` call is inside the main `useEffect` at line ~142. Replace the entire options object:

```typescript
const term = new Terminal({
  cursorBlink: terminalConfig.cursorBlink,
  cursorStyle: terminalConfig.cursorStyle,
  scrollback: terminalConfig.scrollback,
  macOptionIsMeta: terminalConfig.macOptionIsMeta,
  macOptionClickForcesSelection: false,
  theme: terminalConfig.theme,
  fontFamily: terminalConfig.fontFamily,
  fontSize: terminalConfig.fontSize,
  lineHeight: terminalConfig.lineHeight,
  letterSpacing: terminalConfig.letterSpacing,
  allowProposedApi: true,
});
```

- [ ] **Step 4: Add live-update effect**

After the closing `}, [sessionId, workspacePath, shell, shellArgs]);` of the main effect, add:

```typescript
// Apply config changes live to existing terminal instances.
useEffect(() => {
  const term = termRef.current;
  if (!term) return;
  term.options.theme        = terminalConfig.theme;
  term.options.fontSize     = terminalConfig.fontSize;
  term.options.fontFamily   = terminalConfig.fontFamily;
  term.options.lineHeight   = terminalConfig.lineHeight;
  term.options.letterSpacing = terminalConfig.letterSpacing;
  term.options.cursorStyle  = terminalConfig.cursorStyle;
  term.options.cursorBlink  = terminalConfig.cursorBlink;
  term.options.scrollback   = terminalConfig.scrollback;
  term.options.macOptionIsMeta = terminalConfig.macOptionIsMeta;
  // Font metric changes require a refit so cell dimensions recalculate.
  if (fitAddonRef.current) safeFit(fitAddonRef.current);
}, [terminalConfig]);
```

- [ ] **Step 5: Add keybinding handler effect**

After the live-update effect, add:

```typescript
useEffect(() => {
  const term = termRef.current;
  if (!term) return;
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (e.type !== 'keydown') return true;
    const combo = buildCombo(e);
    const binding = terminalConfig.keybindings.find(b => b.key === combo);
    if (!binding) return true;
    switch (binding.action) {
      case 'clear':
        term.clear();
        break;
      case 'scroll-top':
        term.scrollToTop();
        break;
      case 'scroll-bottom':
        term.scrollToBottom();
        break;
      case 'send-text':
        invoke('write_pty', { sessionId, data: binding.text ?? '' }).catch(() => {});
        break;
    }
    return false;
  });
}, [terminalConfig.keybindings, sessionId]);
```

- [ ] **Step 6: Verify TypeScript compiles**

```
bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```
git add src/components/terminal/TerminalTab.tsx
git commit -m "feat(terminal): consume terminalConfig from context with live-update and keybinding effects"
```

---

### Task 6: Settings — state wiring + Colors & Theme card

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add imports**

Add to the existing import block at the top of `Settings.tsx`:

```typescript
import { DEFAULT_TERMINAL_CONFIG, TERMINAL_THEME_PRESETS } from '../utils/terminalThemes';
import type { TerminalConfig, TerminalKeybinding } from '../types';
```

- [ ] **Step 2: Add `terminalConfig` state and `newBinding` draft state**

Inside `SettingsView`, after the `shellsFetchedRef` (around line 248), add:

```typescript
const [terminalConfig, setTerminalConfig] = useState<TerminalConfig>(
  settings.terminalConfig ?? DEFAULT_TERMINAL_CONFIG
);
const [newBinding, setNewBinding] = useState<TerminalKeybinding>({
  key: '', action: 'clear', text: '',
});
```

- [ ] **Step 3: Sync terminalConfig in existing settings useEffect**

In the `useEffect` at line ~250–257 that syncs local state from `settings`, add one line:

```typescript
useEffect(() => {
  setLlmProviders(settings.llmProviders);
  setConductorTaskTimeoutMinutes(settings.conductorTaskTimeoutMinutes);
  setConductorInteractionMode(settings.conductorInteractionMode ?? 'auto');
  setTerminalConfig(settings.terminalConfig ?? DEFAULT_TERMINAL_CONFIG);  // ← add
  if (!useCustomPath) {
    setDefaultShell(settings.shellPath || '');
  }
}, [settings, useCustomPath]);
```

- [ ] **Step 4: Add Colors & Theme card inside the Terminal tab**

The Terminal tab content block starts with `{activeTab === 'terminal' && (`. Inside `<div className={styles.tabContentContainer}>`, after the existing shell `<div className={styles.integrationsCard}>...</div>` block, add:

```tsx
{/* ── Colors & Theme ──────────────────────────────────────────────── */}
<div className={styles.integrationsCard}>
  <h3 className={styles.cardTitle}>
    <span style={{ fontSize: 18, lineHeight: 1 }}>🎨</span>
    <span>Colors & Theme</span>
  </h3>
  <p className={styles.cardDescription}>
    Pick a preset or customize all 22 terminal colors individually.
  </p>

  {/* Preset cards */}
  <div className={css`display:flex;flex-wrap:wrap;gap:8px;`}>
    {TERMINAL_THEME_PRESETS.map(preset => (
      <button
        key={preset.name}
        type="button"
        onClick={() => setTerminalConfig(c => ({ ...c, theme: preset.theme }))}
        className={css`
          padding:5px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;
          border:1px solid ${terminalConfig.theme.background === preset.theme.background
            ? 'var(--color-brand)' : 'var(--border-color)'};
          background:${preset.theme.background};
          color:${preset.theme.foreground};
          transition:border-color 0.15s;
          &:hover{border-color:var(--color-brand);}
        `}
      >
        {preset.name}
      </button>
    ))}
  </div>

  {/* Color grid — color picker + hex/rgba text input per slot */}
  <div className={css`
    display:grid;grid-template-columns:repeat(2,1fr);gap:10px;
    @media(min-width:560px){grid-template-columns:repeat(3,1fr);}
  `}>
    {(
      [
        ['Background',     'background'],
        ['Foreground',     'foreground'],
        ['Cursor',         'cursor'],
        ['Cursor Accent',  'cursorAccent'],
        ['Selection BG',   'selectionBackground'],
        ['Selection FG',   'selectionForeground'],
        ['Black',          'black'],
        ['Bright Black',   'brightBlack'],
        ['Red',            'red'],
        ['Bright Red',     'brightRed'],
        ['Green',          'green'],
        ['Bright Green',   'brightGreen'],
        ['Yellow',         'yellow'],
        ['Bright Yellow',  'brightYellow'],
        ['Blue',           'blue'],
        ['Bright Blue',    'brightBlue'],
        ['Magenta',        'magenta'],
        ['Bright Magenta', 'brightMagenta'],
        ['Cyan',           'cyan'],
        ['Bright Cyan',    'brightCyan'],
        ['White',          'white'],
        ['Bright White',   'brightWhite'],
      ] as [string, keyof TerminalConfig['theme']][]
    ).map(([label, key]) => {
      const val = terminalConfig.theme[key];
      const isRgba = val.startsWith('rgba');
      return (
        <div key={key} className={css`display:flex;flex-direction:column;gap:3px;`}>
          <label className={styles.formLabel}>{label}</label>
          <div className={css`display:flex;align-items:center;gap:5px;`}>
            <input
              type="color"
              title={isRgba ? 'rgba — edit text field for alpha' : undefined}
              value={isRgba ? '#000000' : val}
              onChange={e => setTerminalConfig(c => ({
                ...c, theme: { ...c.theme, [key]: e.target.value },
              }))}
              className={css`width:28px;height:26px;border:none;background:transparent;cursor:pointer;padding:0;flex-shrink:0;`}
            />
            <input
              type="text"
              value={val}
              spellCheck={false}
              onChange={e => setTerminalConfig(c => ({
                ...c, theme: { ...c.theme, [key]: e.target.value },
              }))}
              className={styles.integrationInput}
            />
          </div>
        </div>
      );
    })}
  </div>
</div>
```

- [ ] **Step 5: Verify TypeScript compiles**

```
bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```
git add src/pages/Settings.tsx
git commit -m "feat(settings): add Colors & Theme card to Terminal tab"
```

---

### Task 7: Settings — Font, Cursor, Behavior cards

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add Font card**

After the Colors & Theme card, add:

```tsx
{/* ── Font ──────────────────────────────────────────────────────── */}
<div className={styles.integrationsCard}>
  <h3 className={styles.cardTitle}>
    <span style={{ fontSize: 16, fontFamily: 'monospace', fontWeight: 700 }}>Aa</span>
    <span>Font</span>
  </h3>

  <div>
    <label className={styles.formLabel}>Font Family</label>
    <input
      type="text"
      spellCheck={false}
      className={styles.integrationInput}
      value={terminalConfig.fontFamily}
      onChange={e => setTerminalConfig(c => ({ ...c, fontFamily: e.target.value }))}
      placeholder="'Fira Code', 'Cascadia Code', monospace"
    />
    <p className={css`font-size:10px;color:var(--text-tertiary);margin-top:4px;`}>
      Comma-separated list. First font found on the system is used.
    </p>
  </div>

  <div className={css`display:grid;grid-template-columns:repeat(3,1fr);gap:12px;`}>
    <div>
      <label className={styles.formLabel}>Size (px)</label>
      <input
        type="number" min={8} max={32}
        className={styles.integrationInput}
        value={terminalConfig.fontSize}
        onChange={e => setTerminalConfig(c => ({ ...c, fontSize: Number(e.target.value) }))}
      />
    </div>
    <div>
      <label className={styles.formLabel}>Line Height</label>
      <input
        type="number" min={0.8} max={2.0} step={0.1}
        className={styles.integrationInput}
        value={terminalConfig.lineHeight}
        onChange={e => setTerminalConfig(c => ({ ...c, lineHeight: Number(e.target.value) }))}
      />
    </div>
    <div>
      <label className={styles.formLabel}>Letter Spacing (px)</label>
      <input
        type="number" min={-2} max={10} step={0.5}
        className={styles.integrationInput}
        value={terminalConfig.letterSpacing}
        onChange={e => setTerminalConfig(c => ({ ...c, letterSpacing: Number(e.target.value) }))}
      />
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add Cursor card**

After the Font card, add:

```tsx
{/* ── Cursor ─────────────────────────────────────────────────────── */}
<div className={styles.integrationsCard}>
  <h3 className={styles.cardTitle}>
    <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700 }}>|</span>
    <span>Cursor</span>
  </h3>

  <div>
    <label className={styles.formLabel}>Style</label>
    <div className={css`display:flex;gap:8px;`}>
      {(['block', 'underline', 'bar'] as const).map(s => (
        <button
          key={s}
          type="button"
          onClick={() => setTerminalConfig(c => ({ ...c, cursorStyle: s }))}
          className={css`
            padding:6px 16px;border-radius:4px;font-size:12px;cursor:pointer;
            border:1px solid ${terminalConfig.cursorStyle === s ? 'var(--color-brand)' : 'var(--border-color)'};
            background:${terminalConfig.cursorStyle === s ? 'rgba(123,104,238,0.15)' : 'transparent'};
            color:${terminalConfig.cursorStyle === s ? 'var(--color-brand)' : 'var(--text-secondary)'};
            &:hover{border-color:var(--color-brand);}
          `}
        >
          {s === 'block' ? '█ Block' : s === 'underline' ? '▁ Underline' : '| Bar'}
        </button>
      ))}
    </div>
  </div>

  <label className={css`display:flex;align-items:center;gap:8px;cursor:pointer;`}>
    <input
      type="checkbox"
      checked={terminalConfig.cursorBlink}
      onChange={e => setTerminalConfig(c => ({ ...c, cursorBlink: e.target.checked }))}
    />
    <span className={styles.formLabel} style={{ margin: 0 }}>Cursor blink</span>
  </label>
</div>
```

- [ ] **Step 3: Add Behavior card**

After the Cursor card, add:

```tsx
{/* ── Behavior ────────────────────────────────────────────────────── */}
<div className={styles.integrationsCard}>
  <h3 className={styles.cardTitle}>
    <span style={{ fontSize: 16 }}>⚙</span>
    <span>Behavior</span>
  </h3>

  <div style={{ maxWidth: 200 }}>
    <label className={styles.formLabel}>Scrollback Lines</label>
    <input
      type="number" min={100} max={100000}
      className={styles.integrationInput}
      value={terminalConfig.scrollback}
      onChange={e => setTerminalConfig(c => ({ ...c, scrollback: Number(e.target.value) }))}
    />
  </div>

  <label className={css`display:flex;align-items:center;gap:8px;cursor:pointer;`}>
    <input
      type="checkbox"
      checked={terminalConfig.macOptionIsMeta}
      onChange={e => setTerminalConfig(c => ({ ...c, macOptionIsMeta: e.target.checked }))}
    />
    <span className={styles.formLabel} style={{ margin: 0 }}>
      Option key acts as Meta (macOS) — enables Option+B/F word-jump shortcuts
    </span>
  </label>
</div>
```

- [ ] **Step 4: Verify TypeScript compiles**

```
bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```
git add src/pages/Settings.tsx
git commit -m "feat(settings): add Font, Cursor, Behavior cards to Terminal tab"
```

---

### Task 8: Settings — Keybindings card + wire Save button

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add Keybindings card**

After the Behavior card, add:

```tsx
{/* ── Keybindings ─────────────────────────────────────────────────── */}
<div className={styles.integrationsCard}>
  <h3 className={styles.cardTitle}>
    <span style={{ fontSize: 16 }}>⌨</span>
    <span>Keybindings</span>
  </h3>
  <p className={styles.cardDescription}>
    Map key combos to terminal actions. Format: <code style={{ fontFamily: 'monospace', color: 'var(--color-brand)' }}>ctrl+k</code>, <code style={{ fontFamily: 'monospace', color: 'var(--color-brand)' }}>ctrl+shift+t</code>, <code style={{ fontFamily: 'monospace', color: 'var(--color-brand)' }}>alt+b</code>. Modifiers: ctrl, alt, shift, meta.
  </p>

  {terminalConfig.keybindings.length > 0 && (
    <table className={css`width:100%;font-size:12px;border-collapse:collapse;`}>
      <thead>
        <tr className={css`color:var(--text-secondary);font-weight:700;text-transform:uppercase;font-size:10px;border-bottom:1px solid var(--border-color);`}>
          <th className={css`text-align:left;padding:6px 8px;`}>Key</th>
          <th className={css`text-align:left;padding:6px 8px;`}>Action</th>
          <th className={css`text-align:left;padding:6px 8px;`}>Text</th>
          <th className={css`padding:6px 8px;width:32px;`} />
        </tr>
      </thead>
      <tbody>
        {terminalConfig.keybindings.map((binding, idx) => (
          <tr key={idx} className={css`border-bottom:1px solid var(--border-color);`}>
            <td className={css`padding:6px 8px;font-family:var(--font-family-mono);color:var(--color-brand);`}>
              {binding.key}
            </td>
            <td className={css`padding:6px 8px;color:var(--text-primary);`}>{binding.action}</td>
            <td className={css`padding:6px 8px;font-family:var(--font-family-mono);color:var(--text-secondary);font-size:11px;`}>
              {binding.text || '—'}
            </td>
            <td className={css`padding:6px 8px;`}>
              <button
                type="button"
                onClick={() => setTerminalConfig(c => ({
                  ...c,
                  keybindings: c.keybindings.filter((_, i) => i !== idx),
                }))}
                className={css`background:none;border:none;cursor:pointer;color:var(--text-secondary);font-size:14px;&:hover{color:var(--color-error);}`}
              >
                ✕
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )}

  {/* Add new binding */}
  <div className={css`display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;`}>
    <div className={css`display:flex;flex-direction:column;gap:4px;min-width:110px;`}>
      <label className={styles.formLabel}>Key Combo</label>
      <input
        type="text"
        className={styles.integrationInput}
        value={newBinding.key}
        onChange={e => setNewBinding(b => ({ ...b, key: e.target.value.toLowerCase() }))}
        placeholder="ctrl+k"
        spellCheck={false}
      />
    </div>

    <div className={css`display:flex;flex-direction:column;gap:4px;`}>
      <label className={styles.formLabel}>Action</label>
      <select
        className={styles.integrationInput}
        value={newBinding.action}
        onChange={e => setNewBinding(b => ({
          ...b,
          action: e.target.value as TerminalKeybinding['action'],
        }))}
      >
        <option value="clear">clear</option>
        <option value="scroll-top">scroll-top</option>
        <option value="scroll-bottom">scroll-bottom</option>
        <option value="send-text">send-text</option>
      </select>
    </div>

    {newBinding.action === 'send-text' && (
      <div className={css`display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px;`}>
        <label className={styles.formLabel}>Text / Sequence</label>
        <input
          type="text"
          className={styles.integrationInput}
          value={newBinding.text ?? ''}
          onChange={e => setNewBinding(b => ({ ...b, text: e.target.value }))}
          placeholder="e.g. clear\n"
          spellCheck={false}
        />
      </div>
    )}

    <button
      type="button"
      disabled={!newBinding.key.trim()}
      onClick={() => {
        setTerminalConfig(c => ({
          ...c,
          keybindings: [...c.keybindings, { ...newBinding, key: newBinding.key.trim() }],
        }));
        setNewBinding({ key: '', action: 'clear', text: '' });
      }}
      className={css`
        padding:8px 16px;border-radius:var(--border-radius-sm);font-size:12px;font-weight:700;
        cursor:pointer;border:1px solid var(--color-brand);color:var(--color-brand);background:transparent;
        &:hover:not(:disabled){background:rgba(123,104,238,0.1);}
        &:disabled{opacity:0.4;cursor:not-allowed;}
      `}
    >
      + Add
    </button>
  </div>
</div>
```

- [ ] **Step 2: Update the Save Terminal Settings button handler**

Find the existing save button `onClick` (around line 706) which calls `updateSettings({ shellPath: path })`. Replace only the `updateSettings` call:

```typescript
onClick={() => {
  const path = (useCustomPath ? customShellPath : defaultShell).trim();
  if (!path) { showToast('Shell path is required', 'error'); return; }
  updateSettings({ shellPath: path, terminalConfig });
  showToast('Terminal settings saved', 'success');
}}
```

- [ ] **Step 3: Verify TypeScript compiles**

```
bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```
bun run test
```

Expected: all pass including the 7 `buildCombo` tests from Task 3.

- [ ] **Step 5: Commit**

```
git add src/pages/Settings.tsx
git commit -m "feat(settings): add Keybindings card and wire terminalConfig into Save Terminal Settings"
```

---

## Self-Review

| Spec requirement | Task |
|---|---|
| `TerminalTheme`, `TerminalKeybinding`, `TerminalConfig` types | 1 |
| `terminalConfig?: TerminalConfig` in `AppSettings` | 1 |
| `DEFAULT_TERMINAL_CONFIG` mirrors current hardcoded values | 2 |
| 8 preset themes | 2 |
| `buildCombo` utility + 7 unit tests | 2, 3 |
| DashboardContext migration via `migrateSettings` + initial state | 4 |
| TerminalTab reads config from context at construction | 5 |
| TerminalTab live-update `useEffect` | 5 |
| TerminalTab keybinding handler | 5 |
| Settings: Colors & Theme card with presets + 22-color grid | 6 |
| Settings: Font card | 7 |
| Settings: Cursor card | 7 |
| Settings: Behavior card | 7 |
| Settings: Keybindings card | 8 |
| Save button persists `terminalConfig` | 8 |

All spec requirements covered. No placeholders. Types are consistent: `TerminalConfig`, `TerminalKeybinding`, `TerminalTheme`, `DEFAULT_TERMINAL_CONFIG`, `TERMINAL_THEME_PRESETS`, `buildCombo` defined in Task 2, used consistently in Tasks 4–8.

**Note on rgba colors in color picker:** `selectionBackground` and `selectionForeground` presets use `rgba(...)` strings. The `<input type="color">` shows `#000000` as fallback for these — the text input is the authoritative control for rgba values.
