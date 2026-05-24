// ── Workspace & domain types ──────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;           // e.g. "Factinme", "Bulkin", "Exercisee"
  path: string;           // local directory path
  description: string;
  color: string;          // hex color for visual tags (e.g. "#3b82f6")
  status: 'active' | 'paused' | 'idle';
  currentTask: string;    // free text of what's happening right now
  createdAt: string;
  updatedAt: string;
}

// ── Agent Group ───────────────────────────────────────────────────────────────
// Replaces the old Agent catalog. A group is a named collection of terminal
// tabs that the user has designated as their AI agent terminals for a task.
// Ollama orchestrates terminals within a group; groups are isolated from each other.

export interface AgentGroup {
  id: string;
  name: string;
  workspaceId: string;
  /** Hex colour shown as a dot in the sidebar. e.g. '#ff9d00' */
  color: string;
  /** IDs of TerminalSession tabs that are members of this group.
   *  Session IDs are ephemeral — regenerated on app relaunch.
   *  The user re-adds tabs each session via the group panel. */
  sessionIds: string[];
  createdAt: number;
}

export interface TaskLog {
  id: string;
  workspaceId: string;
  /** Which Agent Group this log entry belongs to. null = not group-specific. */
  groupId: string | null;
  summary: string;        // one-liner summary of handoff/work
  timestamp: string;
  status: 'in-progress' | 'done' | 'blocked';
}

export interface SavedPrompt {
  id: string;
  workspaceId: string;
  /** Which Agent Group this prompt belongs to. null = not group-specific. */
  groupId: string | null;
  title: string;
  content: string;        // full prompt text
  tags: string[];
  createdAt: string;
  usedAt: string | null;  // last time copied/used
}

export interface AppSettings {
  shellPath: string;     // e.g. "powershell.exe", "cmd.exe", "bash", "wsl"
  ollamaHost: string;    // e.g. "http://localhost:11434"
  openaiApiKey: string;
  anthropicApiKey: string;
  conductorOllamaModel: string;       // model used for relay orchestration
  conductorTaskTimeoutMinutes: number; // max minutes a task can run before auto-fail
}

// Global App Data State structure stored as flat JSON on disk
export interface AppData {
  workspaces: Workspace[];
  agentGroups: AgentGroup[];
  taskLogs: TaskLog[];
  savedPrompts: SavedPrompt[];
  settings?: AppSettings;
}
