// ── Pipeline templates ─────────────────────────────────────────────────────────
// Reusable, persistent task pipelines. Mirrors the plans persistence pattern
// (separate JSON file via loadPipelineTemplates / savePipelineTemplates).
// Templates hold NO live session IDs — those are assigned at instantiation.

export interface PipelineTemplateTask {
  id: string;
  title: string;
  description: string;
  /** Optional pattern hint matching a terminal tab title (e.g. "frontend"). */
  agentHint?: string;
  /** Indices of tasks within the template's `tasks` array that must finish first. */
  dependsOnIndices: number[];
}

export interface PipelineTemplate {
  id: string;
  title: string;
  description: string;
  tasks: PipelineTemplateTask[];
  executionMode: 'sequential' | 'parallel';
  tags: string[];
  /** ISO timestamp — when the template was first created. */
  createdAt: string;
  /** ISO timestamp — when the template was last instantiated, or null. */
  usedAt: string | null;
  /** Number of times the template has been instantiated. */
  useCount: number;
}
