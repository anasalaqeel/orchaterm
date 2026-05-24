// ── Workspace & Agent domain types ───────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;           // e.g. "Factinme", "Bulkin", "Exercisee"
  path: string;           // local directory path
  description: string;
  color: string;          // hex color for visual tags (e.g. "#3b82f6")
  status: 'active' | 'paused' | 'idle';
  currentTask: string;    // free text of what's happening right now
  agentId: string | null; // currently assigned agent ID
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;           // e.g. "Claude Code", "Antigravity", "Hermes"
  type: 'terminal' | 'web' | 'ide-plugin' | 'other';
  launchUrl: string | null;     // URL to open in browser
  launchCommand: string | null; // Terminal command to run (via Tauri shell plugin)
  bestUsedFor: string;    // e.g. "Multi-agent orchestration, large refactors"
  assignedWorkspaceId: string | null;
  color: string;
}

export interface TaskLog {
  id: string;
  workspaceId: string;
  agentId: string;
  summary: string;        // one-liner summary of handoff/work
  timestamp: string;
  status: 'in-progress' | 'done' | 'blocked';
}

export interface SavedPrompt {
  id: string;
  workspaceId: string;
  agentId: string;
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
  agents: Agent[];
  taskLogs: TaskLog[];
  savedPrompts: SavedPrompt[];
  settings?: AppSettings;
}
