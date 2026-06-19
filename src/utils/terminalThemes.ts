import type { TerminalConfig, TerminalKeybinding, TerminalTheme } from '../types';

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
  // Industry-standard terminal copy/paste (Windows Terminal, VS Code, GNOME
  // Terminal). Ctrl+Shift+C/V are safe to reserve — shells never use Shift+Ctrl
  // combos, so nothing is stolen from the PTY. Every OTHER combination still
  // passes straight through. Users can remove these or add a 'passthrough'
  // override in Settings. (mac: add meta+c / meta+v if you prefer Cmd.)
  keybindings: [
    { key: 'ctrl+shift+c', action: 'copy' },
    { key: 'ctrl+shift+v', action: 'paste' },
  ],
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

/**
 * Resolves a combo string against the configured terminal keybindings.
 *
 * Pure — no DOM, no side effects. The terminal's key handler uses this as the
 * single source of truth: a `null` result means "no reserved binding", so the
 * key passes through to the PTY (the default for every unconfigured combo).
 *
 * @returns the matching binding, or `null` when nothing is bound to the combo.
 */
export function resolveTerminalKey(
  combo: string,
  keybindings: TerminalKeybinding[],
): TerminalKeybinding | null {
  return keybindings.find((b) => b.key === combo) ?? null;
}

/**
 * Encodes a Ctrl+<key> event as a kitty keyboard protocol CSI-u sequence, or
 * returns `null` when the legacy encoding should be used instead.
 *
 * xterm 5.3 has no kitty keyboard support, so when an app enables the
 * "disambiguate escape codes" flag (bit 1) we must report Ctrl combos as
 * `CSI <codepoint> ; <mods> u` — sending the legacy C0 byte (e.g. \x04 for
 * Ctrl+D) desyncs kitty-aware TUIs, which silently dropped keys (Antigravity
 * CLI's double-Ctrl+D-to-exit failed). Bit 1 is the only flag that changes the
 * legacy Ctrl-code encoding; other bits (e.g. 4 = report alternate keys) leave
 * unambiguous keys legacy, so we don't encode for those.
 *
 * Only pure Ctrl (optionally +Shift) combos on single printable keys are
 * encoded. Alt is excluded so Windows AltGr typing is unaffected, and
 * non-character keys (Enter/Tab/Esc/arrows) keep their legacy encoding — which
 * is correct for the disambiguate flag.
 *
 * @see https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 */
export function kittyEncodeKey(e: KeyboardEvent, flags: number): string | null {
  if ((flags & 1) === 0) return null; // bit 1 = disambiguate escape codes
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.key.length !== 1) return null;
  const codepoint = e.key.toLowerCase().charCodeAt(0);
  if (codepoint < 0x20 || codepoint > 0x7e) return null; // printable ASCII base
  const mods = 1 + (e.shiftKey ? 1 : 0) + 4; // bit 4 = Ctrl
  return `\x1b[${codepoint};${mods}u`;
}

/**
 * Merges a persisted (possibly partial) terminal config with the defaults.
 *
 * Plain object spread would let a saved `keybindings` array fully shadow the
 * defaults — so when we ship a new standard binding (e.g. copy/paste), existing
 * users whose config predates it would never receive it. Instead we backfill
 * each default binding ONLY when the saved config has no entry for that combo.
 * User additions and overrides (including setting a combo to 'passthrough') are
 * always respected, because removing a default = rebinding its combo, not
 * deleting it.
 */
export function mergeTerminalConfig(saved?: Partial<TerminalConfig>): TerminalConfig {
  const merged = { ...DEFAULT_TERMINAL_CONFIG, ...(saved ?? {}) };
  const base = saved?.keybindings ?? [];
  const savedCombos = new Set(base.map((b) => b.key));
  const backfill = DEFAULT_TERMINAL_CONFIG.keybindings.filter((b) => !savedCombos.has(b.key));
  merged.keybindings = [...base, ...backfill];
  return merged;
}
