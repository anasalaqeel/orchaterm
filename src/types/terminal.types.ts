// ── Terminal Session types ────────────────────────────────────────────────────
// Shared via DashboardContext so ConductorView and SessionRegistry can read
// the same session list even after navigating away from the Dashboard.

export interface TerminalSession {
  id: string;
  title: string;
  shell: string;
  shellArgs: string[];
  workspaceId: string;
  /** Set by user in SessionRegistry panel. null = not yet assigned. */
  assignedAgentId: string | null;
}

// ── Session Registry Entry ─────────────────────────────────────────────────────
// Maps an ephemeral PTY session UUID to a registered Agent for display.

export interface SessionRegistryEntry {
  sessionId: string;
  agentId: string;
  agentName: string;
  agentColor: string;
}
