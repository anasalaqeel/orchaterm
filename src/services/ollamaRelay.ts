/**
 * ollamaRelay.ts
 *
 * Pure prompt-building functions for the orchestrator. No HTTP calls.
 * All LLM calls go through LLMProvider implementations in src/services/llm/.
 *
 * Each buildXxxPrompt function returns { system, userContent } ready to pass to
 * provider.complete([{ role: 'user', content: userContent }], system).
 */

import { OrchestratorTaskOutput } from '../types';
export type { ChatMessage } from './llm/types';  // re-export for backward compat

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompletedTaskContext {
  taskTitle: string;
  taskDescription: string;
  agentName: string;
  agentBestUsedFor: string;
  output: OrchestratorTaskOutput;
}

export interface RawPlanTask {
  title: string;
  description: string;
  assignedSessionTitle: string;
  dependsOn: string[];
}

// ── System prompts ────────────────────────────────────────────────────────────

export const RELAY_SYSTEM_PROMPT = `You are a message relay for a multi-agent coding workflow.
Your only job is to reformat completed task output into a clear brief for the next agent.

Rules you must follow:
1. Extract only meaningful results. Ignore shell prompts, file listings, build output, and status messages.
2. Keep your output under 200 words.
3. Do NOT add implementation suggestions or technical opinions.
4. Do NOT explain what you are doing — just write the brief.
5. Write in direct, imperative style addressed to the next agent.
6. Preserve specific identifiers: function names, file paths, API contracts, variable names.`;

export const PLAN_GEN_SYSTEM_PROMPT = `You are a task planner for a multi-agent terminal orchestration system.
Given a goal and a list of available terminal agents, break the goal into a minimal set of concrete tasks.

Return ONLY a valid JSON array. No markdown fences. No explanation. No prose before or after.

JSON format:
[
  {
    "title": "Short task name",
    "description": "Precise, self-contained instructions for the agent. Be specific and direct.",
    "assignedSessionTitle": "<MUST match one of the available agent names exactly>",
    "dependsOn": ["<title of a task that must complete before this one starts>"]
  }
]

Rules:
- Tasks that can run in parallel must NOT depend on each other.
- Each task description must stand alone — the agent receives nothing else.
- Only add a dependency when the task genuinely needs that task's output.
- Assign tasks thoughtfully based on agent names/roles.
- dependsOn titles must exactly match the "title" field of another task in the array.`;

// ── Prompt builders ───────────────────────────────────────────────────────────

export function buildRelayPrompt(
  goal: string,
  completedTask: CompletedTaskContext,
  nextTaskDescription: string,
  nextAgentName: string,
): { system: string; userContent: string } {
  return {
    system: RELAY_SYSTEM_PROMPT,
    userContent: `Overall goal: ${goal}

COMPLETED WORK:
Task: ${completedTask.taskTitle}
Done by: ${completedTask.agentName}
Summary: ${completedTask.output.summary}
Files modified: ${completedTask.output.filesModified.join(', ') || 'none'}
What is needed next: ${completedTask.output.needs}

NEXT TASK:
Task: ${nextTaskDescription}
Next agent: ${nextAgentName}

Write a clear, direct brief for the next agent that gives them everything they need:`,
  };
}

export function buildMergeRelayPrompt(
  goal: string,
  completedTasks: CompletedTaskContext[],
  nextTaskDescription: string,
  nextAgentName: string,
): { system: string; userContent: string } {
  const blocks = completedTasks.map((t, i) => `
--- Completed Work ${i + 1} ---
Task: ${t.taskTitle}
Done by: ${t.agentName}
Summary: ${t.output.summary}
Files modified: ${t.output.filesModified.join(', ') || 'none'}
What is needed next: ${t.output.needs}`).join('\n');

  return {
    system: RELAY_SYSTEM_PROMPT,
    userContent: `Overall goal: ${goal}

COMPLETED WORK FROM MULTIPLE AGENTS:
${blocks}

NEXT TASK:
Task: ${nextTaskDescription}
Next agent: ${nextAgentName}

Synthesize all completed work into a single unified brief for the next agent:`,
  };
}

export function buildAutoAnswerPrompt(promptText: string): { system: string; userContent: string } {
  return {
    system: "You are an automated terminal responder. Output only the keystroke or 'UNKNOWN'.",
    userContent: `A terminal agent is stuck on the following interactive prompt and needs user input to proceed.
Prompt:
"""
${promptText}
"""

Determine what the user should type to accept or safely proceed.
Examples:
- If asked "Do you want to proceed? [y/N]", answer "y"
- If asked "Select an option: 1. Yes 2. No", answer "1"
- If asked "Press Enter to continue", answer "\\n"
- If the prompt is ambiguous, dangerous (e.g. deleting files), or asks for complex text input, answer "UNKNOWN"

Return ONLY the exact keystrokes/text to send. No explanation. No quotes.`,
  };
}

export function buildRoutingPrompt(
  fromTitle: string,
  recentChunk: string,
  siblings: Array<{ title: string; recentOutput: string }>,
): { system: string; userContent: string } {
  const siblingsDesc = siblings
    .map(s => `• ${s.title}:\n${s.recentOutput.slice(-300) || '(no recent output)'}`)
    .join('\n\n');

  return {
    system: 'You are a routing agent for a multi-agent coding team. Be decisive. Output exactly one line.',
    userContent: `You are monitoring a team of AI coding agents.

Agent "${fromTitle}" just produced this output:
${recentChunk.slice(-600)}

Other active agents:
${siblingsDesc}

Should any part of "${fromTitle}"'s output be relayed to another agent right now?

Rules:
1. Only relay if it would DIRECTLY unblock or help another agent with what they are doing.
2. Routine build output, status messages, and progress logs should NOT be relayed.
3. Keep any injected message under 80 words. Be direct — no filler.
4. Do NOT relay if the agents are working on completely independent tasks.

If nothing should be relayed, output exactly: NO_RELAY
If relaying, output exactly one line: INJECT → <exact-terminal-title>: <message>`,
  };
}

export function buildSummarisePrompt(chunk: string, tabTitle: string): { system: string; userContent: string } {
  return {
    system: `You are a terminal output summariser. Summarise the following terminal output from agent "${tabTitle}" in 1–2 concise sentences. Be direct and factual — no filler, no suggestions. Output only the summary text, nothing else.`,
    userContent: chunk.length > 2000 ? chunk.slice(-2000) : chunk,
  };
}

export function buildPlanGenPrompt(
  goal: string,
  availableSessions: Array<{ title: string }>,
): { system: string; userContent: string } {
  return {
    system: PLAN_GEN_SYSTEM_PROMPT,
    userContent: `Goal: ${goal}

Available agents:
${availableSessions.map(s => `• ${s.title}`).join('\n')}

Generate the task plan as a JSON array:`,
  };
}

export function buildNeedsPrompt(
  ask: string,
  context: string,
  requestingAgent: string,
  peerContext: Array<{ title: string; recentOutput: string }>,
): { system: string; userContent: string } {
  const peerBlocks = peerContext.length > 0
    ? peerContext.map(p => `=== ${p.title} ===\n${p.recentOutput || '(no recent output)'}`)
        .join('\n\n')
    : '(no peer agents have recent output)';

  return {
    system: 'You are a helpful synthesiser. Output only a direct answer under 150 words.',
    userContent: `Agent "${requestingAgent}" is asking for help mid-task.

QUESTION: ${ask}
THEIR CONTEXT: ${context || '(none provided)'}

WHAT OTHER AGENTS HAVE BEEN DOING:
${peerBlocks}

Write a direct, actionable answer (≤ 150 words) synthesised from the other agents' work.
Include specific identifiers (function names, file paths, variable names) where relevant.
If the peer output contains no relevant information, say so in one sentence.
Do NOT add suggestions beyond what was asked.`,
  };
}

export function buildIntentClassifyPrompt(message: string): { system: string; userContent: string } {
  return {
    system: "You are a strict classifier. Output exactly one word: 'chat' or 'plan'.",
    userContent: `You are an intent classifier for a developer orchestration tool.
The user is talking to an orchestrator that can either:
1. "chat": Answer questions, route a simple instruction to a terminal, or summarize.
2. "plan": Break down a goal into a multi-step pipeline and assign agents to tasks.

Classify the following user message. If the message describes building a feature, creating a pipeline, or assigning multiple agents to a goal, classify it as "plan". Otherwise, classify it as "chat".

Return ONLY the word "chat" or "plan". No other text.

Message: "${message}"`,
  };
}

// ── Pass-through fallback (no LLM needed) ────────────────────────────────────

export function buildPassThroughBrief(
  completedTasks: CompletedTaskContext[],
  nextTaskDescription: string,
): string {
  const contextLines = completedTasks.map(t =>
    `[Context from: ${t.taskTitle}]\nSummary: ${t.output.summary}\nWhat you need: ${t.output.needs}`
  ).join('\n\n');
  return `${contextLines}\n\nYour task: ${nextTaskDescription}`;
}

// ── Plan JSON parsing (used after calling planGen provider) ──────────────────

export function parsePlanGenResponse(response: string): RawPlanTask[] {
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Plan generation returned no JSON array. Try rephrasing your goal.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Plan generation returned invalid JSON: ${e}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Plan generation returned an empty or invalid task list.');
  }
  return parsed as RawPlanTask[];
}
