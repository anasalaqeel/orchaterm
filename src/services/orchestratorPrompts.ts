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
export type { ChatMessage } from './llm/types'; // re-export for backward compat

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
  /** Optional post-completion verification command (see PLAN_GEN_SYSTEM_PROMPT). */
  verify?: string;
  /** Optional user gate question (see PLAN_GEN_SYSTEM_PROMPT). */
  askUser?: string;
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
      "description": "Precise, self-contained instructions for the agent — ONLY the actual work to perform. Be specific and direct.",
      "assignedSessionTitle": "<MUST match one of the available agent names exactly>",
      "dependsOn": [],
      "verify": "<optional: one shell command that PROVES this task succeeded, run automatically after the agent finishes. Omit if no meaningful check exists.>",
      "askUser": "<optional: the exact question to ask the user before this task runs, when their input/approval is required mid-flow. Omit for normal tasks.>"
    }
  ]
}

Verification rules ("verify"):
- Prefer a command whose EXIT CODE is 0 exactly when the task succeeded, e.g. "npm test -- --runTestsByPath tests/auth.test.ts", "node -e \\"require('./src/api')\\"", "git diff --name-only -- src/ | grep -q login".
- Keep it side-effect-free where possible (tests/builds fine; never deploy or mutate remote state).
- Omit "verify" entirely when no such command exists — do not invent weak checks.

CRITICAL — description must contain ONLY the work itself, never routing/meta language:
The description is typed directly into the assigned agent's terminal as its instructions. It must read like a task you'd hand a person, NOT like a sentence about the orchestration system. Routing information (which tab/agent handles this) already lives in "assignedSessionTitle" — never repeat it inside "description".
  - User says "make agy say hi" → description: "Say hi" (NOT "make the agent in this tab say hi" / NOT "tell agy to say hi").
  - User says "have agy2 answer agy's greeting" → description: "Reply to the greeting you received." (NOT "make the agent in this tab answer agy").
  - Strip phrases like "in this tab", "tell X to...", "make the agent...", "have Y do...", "ask Z to..." — these describe orchestration, not the task.

Dependency rules — this is critical:
- dependsOn: [] means the task starts immediately. Tasks with no dependsOn run IN PARALLEL with each other.
- Add a dependency (dependsOn: ["Previous Task Title"]) when:
  1. The task requires the output, summary, or result from a previous task before it can start (e.g. answering a previous step, building upon code/schema created by a previous step, or verifying a previous step).
  2. The user explicitly requests sequential execution (e.g. using words like "first X then Y", "step 1 -> step 2", or "after that").
- Only use dependsOn: [] (parallel execution) when tasks are completely independent and can run simultaneously without needing anything from each other.

Parallelism examples (dependsOn: []):
  - "Write backend auth endpoints" and "Write frontend login form" can start at the same time if the API contract is already fixed and independent.
  - "Add unit tests for module A" and "Add unit tests for module B" have no dependency on each other.

Dependency examples (dependsOn required):
  - "Answer the agent" depends on "Say hi" because it must know what the previous agent said.
  - "Implement payment checkout" depends on "Design payment API schema" because it must import the schema.
  - "Deploy to staging" depends on "Build production bundle" because it needs the built artifact.

Other rules:
- Specify enough in each task description that the agent can work without waiting — include interface shapes, file paths, function signatures if known.
- Each task description must stand alone — the agent receives nothing else about the plan.
- Assign tasks based on agent names/roles when they suggest specialization.
- dependsOn values must exactly match the "title" field of another task in the tasks array.
- User gates ("askUser"): when the flow genuinely cannot continue without the user's decision (approval to deploy, choosing between options, providing a secret), emit a task whose only fields are "title", "askUser" (the exact question), "assignedSessionTitle" (any agent — it runs no terminal work) and "dependsOn". The orchestrator asks the user and feeds their answer to downstream tasks. Never use gates for anything an agent can decide itself.`;

// ── Prompt builders ───────────────────────────────────────────────────────────

export function buildRelayPrompt(
  goal: string,
  completedTask: CompletedTaskContext,
  nextTaskDescription: string,
  nextAgentName: string
): { system: string; userContent: string } {
  const needsNote =
    !completedTask.output.needs || completedTask.output.needs.toLowerCase() === 'none'
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
  nextAgentName: string
): { system: string; userContent: string } {
  const blocks = completedTasks
    .map((t, i) => {
      const needsNote =
        !t.output.needs || t.output.needs.toLowerCase() === 'none'
          ? 'No specific technical prerequisites requested.'
          : t.output.needs;
      return `
--- Completed Work ${i + 1} ---
Task: ${t.taskTitle}
Done by: ${t.agentName}
Summary: ${t.output.summary}
Files modified: ${t.output.filesModified.join(', ') || 'none'}
What is needed next: ${needsNote}`;
    })
    .join('\n');

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
    system:
      'You are an automated terminal responder for an AI coding agent. Output ONLY the answer token. Never explain.',
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
  siblings: Array<{ title: string; recentOutput: string }>
): { system: string; userContent: string } {
  const siblingsDesc = siblings
    .map((s) => `• ${s.title}:\n${s.recentOutput.slice(-300) || '(no recent output)'}`)
    .join('\n\n');

  return {
    system:
      'You are a routing agent for a multi-agent coding team. Be decisive. Output exactly one line.',
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

export function buildSummarisePrompt(
  chunk: string,
  tabTitle: string
): { system: string; userContent: string } {
  return {
    system: `You are a terminal output summariser. Summarise the following terminal output from agent "${tabTitle}" in 1–2 concise sentences. Be direct and factual — no filler, no suggestions. Output only the summary text, nothing else.`,
    userContent: chunk.length > 2000 ? chunk.slice(-2000) : chunk,
  };
}

export function buildPlanGenPrompt(
  goal: string,
  availableSessions: Array<{ title: string }>
): { system: string; userContent: string } {
  return {
    system: PLAN_GEN_SYSTEM_PROMPT,
    userContent: `Goal: ${goal}

Available agents:
${availableSessions.map((s) => `• ${s.title}`).join('\n')}

Generate the task plan as a JSON array:`,
  };
}

export function buildNeedsPrompt(
  ask: string,
  context: string,
  requestingAgent: string,
  peerContext: Array<{ title: string; recentOutput: string }>
): { system: string; userContent: string } {
  const peerBlocks =
    peerContext.length > 0
      ? peerContext
          .map((p) => `=== ${p.title} ===\n${p.recentOutput || '(no recent output)'}`)
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

export function buildIntentClassifyPrompt(message: string): {
  system: string;
  userContent: string;
} {
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

// ── Soft-completion judge (idle fallback when no sentinel is printed) ────────

export interface CompletionJudgeVerdict {
  complete: boolean;
  summary: string;
}

/**
 * Asks a small model whether the task's goal was accomplished, based on the
 * terminal output alone. Used when a dispatched task's terminal went quiet and
 * returned to its prompt without printing the sentinel completion block.
 */
export function buildCompletionJudgePrompt(
  taskTitle: string,
  taskDescription: string,
  terminalTail: string
): { system: string; userContent: string } {
  return {
    system:
      'You judge whether a terminal agent finished its assigned task. Reply with DONE or WAITING as the first word. Never explain before the first word.',
    userContent: `A task was dispatched to an agent in a terminal. The terminal has gone quiet and returned to its prompt WITHOUT printing the required completion block, so the result must be judged from the output alone.

TASK: ${taskTitle}
INSTRUCTIONS GIVEN TO THE AGENT: ${taskDescription}

LAST TERMINAL OUTPUT (ANSI stripped, may be truncated):
"""
${terminalTail}
"""

Rules:
1. Reply DONE only if the output shows the instructed work was finished (the agent reported/completed it, or a plain command ran to completion). Reply WAITING if it is still working, streaming, showing a spinner, or failed with an error it has not recovered from.
2. If the terminal is showing a question, permission dialog, or option menu, reply WAITING.
3. First line: exactly DONE or WAITING. If DONE, add a second line: a 1-2 sentence factual summary of what was accomplished. No other text.`,
  };
}

/**
 * Parses the judge model's reply. The first line must be exactly DONE (or
 * DONE with trailing punctuation) — anything else, including malformed or
 * hedged replies, is treated as WAITING so a bad reply can never complete a
 * task on its own.
 */
export function parseCompletionJudgeResponse(response: string): CompletionJudgeVerdict {
  const lines = response.trim().split('\n');
  const first = (lines[0] ?? '').trim().toUpperCase();
  if (!/^DONE[.!]?$/.test(first)) return { complete: false, summary: '' };
  const summary = lines.slice(1).join(' ').trim();
  return {
    complete: true,
    summary:
      summary || 'Task finished (terminal returned to its prompt; no completion block was output).',
  };
}

// ── Auto-replan (invoked when a task failure blocks the plan) ───────────────

export interface ReplanFailedTask {
  title: string;
  description: string;
  agentTitle: string;
  /** Last terminal output before the failure — evidence of what went wrong. */
  failureTail: string;
}

/**
 * Asks the planner to replace a failed task with one or two tasks that
 * actually finish the failed work, in the same JSON schema as plan generation.
 */
export function buildReplanPrompt(
  goal: string,
  failedTask: ReplanFailedTask,
  remainingTasks: Array<{ title: string; description: string; agentTitle: string }>,
  availableAgents: string[]
): { system: string; userContent: string } {
  return {
    system: PLAN_GEN_SYSTEM_PROMPT,
    userContent: `A task in an in-flight pipeline FAILED and blocked everything downstream. Replace it.

Overall goal: ${goal}

FAILED TASK:
Title: ${failedTask.title}
Instructions given: ${failedTask.description}
Agent: ${failedTask.agentTitle}
Last terminal output before failure (may show the error):
"""
${failedTask.failureTail}
"""

REMAINING TASKS (do NOT include these again — only produce replacements for the failed task):
${remainingTasks.map((t) => `• ${t.title} (agent ${t.agentTitle})`).join('\n') || '(none)'}

Available agents: ${availableAgents.join(', ')}

Produce 1-2 replacement tasks that finish the failed work despite the error (split it, simplify it, or reassign it to a better-suited agent).
- Replacement tasks' dependsOn must reference the SAME upstream task titles the failed task depended on (or other replacement titles).
- The orchestrator will re-point downstream tasks onto your replacements automatically.

Return ONLY the JSON object with a "tasks" array. No prose.`,
  };
}

// ── Pass-through fallback (no LLM needed) ────────────────────────────────────

export function buildPassThroughBrief(
  completedTasks: CompletedTaskContext[],
  nextTaskDescription: string
): string {
  const contextLines = completedTasks
    .map(
      (t) =>
        `[Context from: ${t.taskTitle}]\nSummary: ${t.output.summary}\nWhat you need: ${t.output.needs}`
    )
    .join('\n\n');
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
          goal:
            typeof parsed.goal === 'string' && parsed.goal.trim()
              ? parsed.goal.trim()
              : fallbackGoal,
          tasks: parsed.tasks as RawPlanTask[],
        };
      }
    } catch {
      /* fall through to array format */
    }
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
