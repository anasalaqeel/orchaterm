// ── Workspace & domain types ──────────────────────────────────────────────────
import type { TerminalConfig, QuickAction } from './terminal.types';
import type { UseCaseProviders, ProviderConfig } from '../services/llm/types';
import type { ContinuationConfig } from './continuation.types';

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

// ── Space ─────────────────────────────────────────────────────────────────────
// A named sub-space within a workspace. Groups terminal tabs into a focused
// context; the Conductor and Chat panel are scoped to the active Space.

export interface Space {
  id: string;
  name: string;
  workspaceId: string;
  /** Hex colour shown as a dot in the sidebar. e.g. '#ff9d00' */
  color: string;
  /** IDs of TerminalSession tabs that belong to this space.
   *  Session IDs are ephemeral — regenerated on app relaunch.
   *  The user re-adds tabs each session via the space panel. */
  sessionIds: string[];
  createdAt: number;
}

export interface TaskLog {
  id: string;
  workspaceId: string;
  /** Which Space this log entry belongs to. null = not space-specific. */
  spaceId: string | null;
  summary: string;        // one-liner summary of handoff/work
  timestamp: string;
  status: 'in-progress' | 'done' | 'blocked';
}

export interface SavedPrompt {
  id: string;
  workspaceId: string;
  /** Which Space this prompt belongs to. null = not space-specific. */
  spaceId: string | null;
  title: string;
  content: string;        // full prompt text
  tags: string[];
  createdAt: string;
  usedAt: string | null;  // last time copied/used
}

export interface AppSettings {
  shellPath: string;
  conductorTaskTimeoutMinutes: number;
  /** 'auto' = LLM answers agent prompts automatically. 'manual' = user must INJECT answers. */
  conductorInteractionMode: 'auto' | 'manual';
  /** Mode for LLM providers configuration: 'simple' uses one provider for everything, 'advanced' allows per-use-case config. */
  llmProviderMode?: 'simple' | 'advanced';
  /** The single provider configuration used when llmProviderMode is 'simple'. */
  simpleLlmProvider?: ProviderConfig;
  /** Per-use-case LLM provider configuration used when llmProviderMode is 'advanced'. */
  llmProviders: UseCaseProviders;
  /** API keys keyed by `provider:baseUrl` — persists keys across provider switches. */
  providerApiKeys?: Record<string, string>;
  terminalConfig?: TerminalConfig;
  /**
   * Master switch for all AI/orchestration features (live feed, auto-relay,
   * session continuation, chat send). When false the app is a plain terminal
   * emulator and makes zero LLM calls regardless of the per-feature toggles.
   * Defaults to true (read as `aiEnabled !== false`).
   */
  aiEnabled?: boolean;
  continuation?: ContinuationConfig;
  // ── Legacy fields kept for one-time migration on first load ──────────────
  /** @deprecated Use llmProviders.relay.baseUrl instead. */
  ollamaHost?: string;
  /** @deprecated No longer used directly. */
  openaiApiKey?: string;
  /** @deprecated No longer used directly. */
  anthropicApiKey?: string;
  /** @deprecated Use llmProviders.relay.model instead. */
  conductorOllamaModel?: string;
  /** Quick actions shown in the terminal action bar */
  quickActions?: QuickAction[];
}

// Global App Data State structure stored as flat JSON on disk
export interface AppData {
  workspaces: Workspace[];
  spaces: Space[];
  taskLogs: TaskLog[];
  savedPrompts: SavedPrompt[];
  settings?: AppSettings;
}
