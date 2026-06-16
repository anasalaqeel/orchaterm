// ── Terminal Session types ────────────────────────────────────────────────────
// Shared via DashboardContext so the Conductor and Chat panels can read
// the same session list.

import { InterruptPolicy } from './autonomous.types';

export interface TerminalSession {
  id: string;
  title: string;
  shell: string;
  shellArgs: string[];
  workspaceId: string;
  /** Hex colour for the tab indicator. null = default (no colour). */
  color: string | null;
  /** Display order within the tab strip. Lower = leftmost. */
  order: number;
  /**
   * Controls when automated messages (from NeedsBroker or AutonomousOrchestrator)
   * may be injected into this terminal.
   * Default: 'never' — safe for all agent types.
   */
  interruptPolicy: InterruptPolicy;
}

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
  action: 'clear' | 'scroll-top' | 'scroll-bottom' | 'send-text' | 'copy' | 'paste' | 'passthrough';
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
