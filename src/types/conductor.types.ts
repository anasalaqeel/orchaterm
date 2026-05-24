// ── Orchestrator / Conductor types ────────────────────────────────────────────

export type OrchestratorTaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface OrchestratorTask {
  id: string;
  title: string;
  /** Full task instructions. Sentinel instruction is appended automatically by the engine. */
  description: string;
  /** Which PTY session this task runs in. */
  assignedSessionId: string;
  /** Which registered Agent is in that session (for display only). */
  assignedAgentId: string;
  /** IDs of tasks that must be 'done' before this task is dispatched. Empty = no deps. */
  dependsOn: string[];
  status: OrchestratorTaskStatus;
  startedAt?: number;   // Unix ms — set when write_pty is called
  completedAt?: number; // Unix ms — set when sentinel is detected
  output?: OrchestratorTaskOutput;
}

export interface OrchestratorTaskOutput {
  /** Raw terminal output stripped of ANSI codes, from dispatch point to sentinel. */
  raw: string;
  taskId: string;
  summary: string;
  filesModified: string[];
  needs: string;
  /** The brief Ollama generated for the next agent. Stored for display in conductor log. */
  relayedBrief?: string;
}

export type OrchestratorPlanStatus =
  | 'draft'    // in Plan Builder, not yet run
  | 'approved' // user approved, ready to run
  | 'running'  // at least one task is running
  | 'paused'   // user paused mid-run
  | 'done'     // all tasks done
  | 'failed';  // a task failed and blocked all remaining tasks

export interface OrchestratorPlan {
  id: string;
  goal: string;
  tasks: OrchestratorTask[];
  status: OrchestratorPlanStatus;
  createdAt: number;
  completedAt?: number;
}

// ── Per-session Buffer (in-memory only) ───────────────────────────────────────

export type BufferWatchMode = 'sentinel' | 'plan' | 'idle';

export interface SessionBuffer {
  sessionId: string;
  buffer: string;
  lastActivity: number;
  mode: BufferWatchMode;
}

// ── Conductor Log ─────────────────────────────────────────────────────────────

export interface ConductorLogEntry {
  id: string;
  timestamp: number;
  type: 'dispatch' | 'sentinel' | 'relay' | 'timeout' | 'error' | 'info' | 'user-override';
  message: string;
  taskId?: string;
  sessionId?: string;
}
