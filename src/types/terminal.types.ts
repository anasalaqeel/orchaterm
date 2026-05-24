// ── Terminal Session types ────────────────────────────────────────────────────
// Shared via DashboardContext so the Conductor and Chat panels can read
// the same session list.

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
}
