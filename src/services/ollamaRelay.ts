/**
 * ollamaRelay.ts
 *
 * Handles all communication with the local Ollama instance for the orchestrator.
 * Ollama's only role here is mechanical: strip noise, reformat, and craft a clear
 * brief for the next agent. It never plans, codes, or makes decisions.
 *
 * Exported functions:
 *   fetchOllamaModels   — returns the list of models the user has pulled
 *   checkOllamaOnline   — quick liveness check
 *   relayViaOllama      — single-parent task handoff
 *   mergeAndRelayViaOllama — fan-in: multiple parents → one unified brief
 */

import { OrchestratorTaskOutput } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CompletedTaskContext {
  taskTitle: string;
  taskDescription: string;
  agentName: string;
  agentBestUsedFor: string;
  output: OrchestratorTaskOutput;
}

export interface RelayInput {
  goal: string;
  completedTask: CompletedTaskContext;
  nextTaskDescription: string;
  nextAgentName: string;
  nextAgentBestUsedFor: string;
  ollamaHost: string;
  model: string;
}

export interface MergeRelayInput {
  goal: string;
  completedTasks: CompletedTaskContext[];
  nextTaskDescription: string;
  nextAgentName: string;
  nextAgentBestUsedFor: string;
  ollamaHost: string;
  model: string;
}

// ── System prompt ──────────────────────────────────────────────────────────────
// Shared across all relay calls. Keeps Ollama in its mechanical lane.

const SYSTEM_PROMPT = `You are a message relay for a multi-agent coding workflow.
Your only job is to reformat completed task output into a clear brief for the next agent.

Rules you must follow:
1. Extract only meaningful results. Ignore shell prompts, file listings, build output, and status messages.
2. Keep your output under 200 words.
3. Do NOT add implementation suggestions or technical opinions.
4. Do NOT explain what you are doing — just write the brief.
5. Write in direct, imperative style addressed to the next agent.
6. Preserve specific identifiers: function names, file paths, API contracts, variable names.`;

// ── Ollama API helpers ─────────────────────────────────────────────────────────

/**
 * Fetches the list of model names available in the user's local Ollama instance.
 * Returns an empty array if Ollama is offline or the request fails.
 */
export async function fetchOllamaModels(ollamaHost: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${ollamaHost}/api/tags`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) return [];
    const data = await res.json();
    return (data.models ?? []).map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
}

/**
 * Returns true if Ollama is reachable at the given host, false otherwise.
 * Uses a 2-second timeout to avoid hanging.
 */
export async function checkOllamaOnline(ollamaHost: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${ollamaHost}/api/tags`, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Internal: calls the Ollama /api/chat endpoint with the given messages.
 * Throws on network error or non-OK response.
 */
async function callOllama(
  ollamaHost: string,
  model: string,
  userPrompt: string
): Promise<string> {
  const response = await fetch(`${ollamaHost}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const text = data.message?.content ?? data.response ?? '';
  if (!text) throw new Error('Ollama returned an empty response');
  return text.trim();
}

// ── Single-parent relay ────────────────────────────────────────────────────────

/**
 * Relays the output of one completed task into a clear brief for the next task.
 * Used when the next task has exactly one dependency.
 *
 * Throws if Ollama is unreachable — callers should catch and use pass-through.
 */
export async function relayViaOllama(input: RelayInput): Promise<string> {
  const { goal, completedTask, nextTaskDescription, nextAgentName, nextAgentBestUsedFor, ollamaHost, model } = input;

  const userPrompt = `Overall goal: ${goal}

COMPLETED WORK:
Task: ${completedTask.taskTitle}
Done by: ${completedTask.agentName} (${completedTask.agentBestUsedFor})
Summary: ${completedTask.output.summary}
Files modified: ${completedTask.output.filesModified.length > 0 ? completedTask.output.filesModified.join(', ') : 'none'}
What is needed next: ${completedTask.output.needs}

NEXT TASK:
Task: ${nextTaskDescription}
Next agent: ${nextAgentName} (${nextAgentBestUsedFor})

Write a clear, direct brief for the next agent that gives them everything they need:`;

  return callOllama(ollamaHost, model, userPrompt);
}

// ── Multi-parent merge relay ───────────────────────────────────────────────────

/**
 * Merges the outputs of multiple completed tasks (fan-in) into a single unified
 * brief for the next task. Used when the next task depends on 2+ parent tasks.
 *
 * Throws if Ollama is unreachable — callers should catch and use pass-through.
 */
export async function mergeAndRelayViaOllama(input: MergeRelayInput): Promise<string> {
  const { goal, completedTasks, nextTaskDescription, nextAgentName, nextAgentBestUsedFor, ollamaHost, model } = input;

  const completedBlocks = completedTasks.map((t, i) => `
--- Completed Work ${i + 1} ---
Task: ${t.taskTitle}
Done by: ${t.agentName} (${t.agentBestUsedFor})
Summary: ${t.output.summary}
Files modified: ${t.output.filesModified.length > 0 ? t.output.filesModified.join(', ') : 'none'}
What is needed next: ${t.output.needs}`).join('\n');

  const userPrompt = `Overall goal: ${goal}

COMPLETED WORK FROM MULTIPLE AGENTS:
${completedBlocks}

NEXT TASK:
Task: ${nextTaskDescription}
Next agent: ${nextAgentName} (${nextAgentBestUsedFor})

Synthesize all the completed work into a single unified brief for the next agent:`;

  return callOllama(ollamaHost, model, userPrompt);
}

// ── Pass-through fallback ──────────────────────────────────────────────────────

/**
 * Constructs a relay brief without Ollama by directly using the structured
 * sentinel fields. Used when Ollama is offline.
 *
 * The capable agents write `summary` and `needs` fields that are already
 * concise and structured — this fallback uses them as-is.
 */
export function buildPassThroughBrief(
  completedTasks: CompletedTaskContext[],
  nextTaskDescription: string
): string {
  const contextLines = completedTasks.map(t =>
    `[Context from: ${t.taskTitle}]\nSummary: ${t.output.summary}\nWhat you need: ${t.output.needs}`
  ).join('\n\n');

  return `${contextLines}

Your task: ${nextTaskDescription}`;
}
