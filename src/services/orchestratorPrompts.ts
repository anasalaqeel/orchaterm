/**
 * orchestratorPrompts.ts
 *
 * Pure prompt-building functions for the orchestrator. Agnostic to API provider.
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
Your only job is to reformat completed task output into a factual, concise brief for the next agent.

Rules you must follow:
1. Extract only meaningful factual results. Ignore shell prompts, file listings, build output, and status messages.
2. Keep your output under 150 words. Be concise and direct.
3. Do NOT add implementation suggestions, architectural advice, or technical opinions.
4. Do NOT invent code requirements or software development tasks if the completed work or next task is simple/conversational (like answering a greeting, running a shell command, or reporting status).
5. Do NOT explain what you are doing — just write the brief.
6. Write in direct, imperative style addressed to the next agent without exaggerating the scope of the task.
7. Preserve specific identifiers: function names, file paths, API contracts, variable names when present.`;

export const PLAN_GEN_SYSTEM_PROMPT = `You are a task planner for a multi-agent terminal orchestration system.
Given a user request and a list of available terminal agents, extract the core technical goal and break it into a minimal set of concrete tasks.

Return ONLY a valid JSON object. No markdown fences. No explanation. No prose before or after.

JSON format:
{
  "goal": "Concise technical goal extracted from the user request. Strip orchestrator meta-instructions (role assignments, 'share with me', 'let me know', etc.) — keep only the actionable coding objective.",
  "tasks": [
    {
      "title": "Short task name",
      "description": "Precise, self-contained instructions for the agent. Be specific and direct.",
      "assignedSessionTitle": "<MUST match one of the available agent names exactly>",
      "dependsOn": []
    }
  ]
}

Dependency rules — this is critical:
- dependsOn: [] means the task starts immediately. Tasks with no dependsOn run IN PARALLEL with each other.
- Add a dependency ONLY when the task cannot start without the other task's output — e.g. it needs to call an API the other task defines, import a module the other task writes, or build on a schema the other task designs.
- Do NOT add a dependency just because tasks are logically related or touch the same area of the codebase.
- Do NOT chain tasks sequentially by default. Prefer parallel execution.

Parallelism examples (dependsOn: []):
  - "Write backend auth endpoints" and "Write frontend login form" can start at the same time if the API contract is specified in the task description.
  - "Add unit tests for module A" and "Add unit tests for module B" have no dependency on each other.

Dependency examples (dependsOn required):
  - "Implement payment checkout" depends on "Design payment API schema" because it must import the schema.
  - "Deploy to staging" depends on "Build production bundle" because it needs the built artifact.

Other rules:
- Specify enough in each task description that the agent can work without waiting — include interface shapes, file paths, function signatures if known.
- Each task description must stand alone — the agent receives nothing else about the plan.
- Assign tasks based on agent names/roles when they suggest specialization.
- dependsOn values must exactly match the "title" field of another task in the tasks array.`;

// ── Prompt builders ───────────────────────────────────────────────────────────

export function buildRelayPrompt(
  goal: string,
  completedTask: CompletedTaskContext,
  nextTaskDescription: string,
  nextAgentName: string,
): { system: string; userContent: string } {
  const needsNote = !completedTask.output.needs || completedTask.output.needs.toLowerCase() === 'none'
    ? 'No specific technical prerequisites were requested by the previous agent.'
    : completedTask.output.needs;

  return {
    system: RELAY_SYSTEM_PROMPT,
    userContent: `Overall goal: ${goal}

COMPLETED WORK:
Task: ${completedTask.taskTitle}
Done by: ${completedTask.agentName}
Summary: ${completedTask.output.summary}
Files modified: ${completedTask.output.filesModified.join(', ') || 'none'}
What is needed next: ${needsNote}

NEXT TASK:
Task: ${nextTaskDescription}
Next agent: ${nextAgentName}

Write a clear, direct brief for the next agent that gives them what they need without inventing complex code implementation requirements:`,
  };
}

export function buildMergeRelayPrompt(
  goal: string,
  completedTasks: CompletedTaskContext[],
  nextTaskDescription: string,
  nextAgentName: string,
): { system: string; userContent: string } {
  const blocks = completedTasks.map((t, i) => {
    const needsNote = !t.output.needs || t.output.needs.toLowerCase() === 'none'
      ? 'No specific technical prerequisites requested.'
      : t.output.needs;
    return `
--- Completed Work ${i + 1} ---
Task: ${t.taskTitle}
Done by: ${t.agentName}
Summary: ${t.output.summary}
Files modified: ${t.output.filesModified.join(', ') || 'none'}
What is needed next: ${needsNote}`;
  }).join('\n');

  return {
    system: RELAY_SYSTEM_PROMPT,
    userContent: `Overall goal: ${goal}

COMPLETED WORK FROM MULTIPLE AGENTS:
${blocks}

NEXT TASK:
Task: ${nextTaskDescription}
Next agent: ${nextAgentName}

Synthesize all completed work into a single unified brief for the next agent without inventing complex code implementation requirements:`,
  };
}

export function buildAutoAnswerPrompt(promptText: string): { system: string; userContent: string } {
  return {
    system: "You are an automated terminal responder for an AI coding agent. Output ONLY the answer token. Never explain.",
    userContent: `Below is the last ~3000 characters of a terminal session running an AI coding agent.

Terminal tail:
"""
${promptText}
"""

STEP 1 — Is the terminal actually waiting for user input RIGHT NOW?
Signs it IS waiting: a selection cursor ("> 1."), a [y/N] bracket, a permission dialog ("Requesting permission for:"), a navigation footer ("↑/↓ Navigate"), or a bare question on the last non-empty line with no further output after it.
Signs it is NOT waiting: the question appears mid-output, the agent is still writing (more lines follow the question), or it is just status/log text that contains a "?".
If NOT waiting → return UNKNOWN immediately.

STEP 2 — Identify the prompt and answer it using these rules (apply in order):
1. Navigation footer lines ("↑/↓ Navigate", "tab Amend", "esc to cancel", "e edit command") are UI hints — NOT answer options. Ignore them when choosing.
2. "Press Enter to continue" / "press any key" / empty-input continue prompts → ENTER
3. Yes/no question ([y/N], [Y/n], "Do you want to", "Would you like to", "Shall we", etc.) → y
4. Numbered option menu where option 1 is "Yes", "Allow", "Proceed", "Continue", or any affirmative/permissive action → 1
5. Permission to read a file, execute a command, install a package, write a file, or run bash in the project → 1 (always allow for project work)
6. "Always allow" option exists (persist permission) → pick that option number over a one-time allow
7. The agent is directly asking a question that requires specific factual input (e.g. "What is the database name?", "Enter your API key:", "Enter filename:") → UNKNOWN
8. The prompt would permanently destroy data, force-push to production, or drop a live database → UNKNOWN

Return ONLY the answer token. No quotes, no explanation.
Valid tokens: single character (y/n/1/2/3/4), the word ENTER, or UNKNOWN.
Examples:
  "Do you want to proceed?  > 1. Yes  2. No" → 1
  "[y/N]" → y
  "Press Enter to continue" → ENTER
  "Requesting permission for: npm install …  1. Yes  2. Yes, and always allow  3. No" → 2
  "Enter your commit message:" → UNKNOWN
  (agent mid-output that mentions "should we do X?") → UNKNOWN`,
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

export interface PlanGenResult {
  goal: string;
  tasks: RawPlanTask[];
}

export function parsePlanGenResponse(response: string, fallbackGoal: string): PlanGenResult {
  // Try new object format first: { "goal": "...", "tasks": [...] }
  const objMatch = response.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as Record<string, unknown>;
      if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
        return {
          goal: typeof parsed.goal === 'string' && parsed.goal.trim()
            ? parsed.goal.trim()
            : fallbackGoal,
          tasks: parsed.tasks as RawPlanTask[],
        };
      }
    } catch { /* fall through to array format */ }
  }

  // Fallback: legacy plain array format
  const arrMatch = response.match(/\[[\s\S]*\]/);
  if (!arrMatch) throw new Error('Plan generation returned no JSON. Try rephrasing your goal.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrMatch[0]);
  } catch (e) {
    throw new Error(`Plan generation returned invalid JSON: ${e}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Plan generation returned an empty or invalid task list.');
  }
  return { goal: fallbackGoal, tasks: parsed as RawPlanTask[] };
}
