/**
 * continuationPrompts.ts
 *
 * Pure prompt-building functions for session continuation detection and checkpoint narratives.
 * No HTTP calls or Tauri dependencies.
 *
 * Each buildXxxPrompt function returns { system, userContent } ready to pass to
 * provider.complete([{ role: 'user', content: userContent }], system).
 */

export const DETECTION_SYSTEM_PROMPT = `You are monitoring a terminal session running a coding agent.
Classify the agent's current state as EXACTLY one of these labels:

PROGRESS      — agent is actively writing code, making file changes, running commands, or making forward progress
STALLED       — agent is waiting for input, paused, or idle but has NOT hit a usage/context limit
LIMIT_HIT     — agent hit a token, context, or usage limit and cannot continue
              (look for: "usage limit", "context length exceeded", "tokens used up", "context window", "rate limit", "quota exceeded")
STOPPED       — agent exited, crashed, or terminated unexpectedly (shell prompt appeared, process ended)
TASK_COMPLETE — agent finished the task successfully on its own

Respond with ONLY the label — one word, no explanation, no punctuation.`;

export const CHECKPOINT_SYSTEM_PROMPT = `You are a technical writer summarizing a coding agent session for handoff to a new agent.
You will receive raw terminal output. Extract only meaningful technical content — ignore shell prompts, file listings, and build noise.

Write EXACTLY these sections with EXACTLY these headings (markdown h2):

## What Was Done
(150–200 words, past tense, specific — what was built, edited, or changed)

## Files Modified
(bullet list: \`path/to/file\` — one-line description of what changed. Write "None identified" if unclear.)

## Decisions Made
(key technical choices, tradeoffs, patterns selected)

## Where It Stopped
(the exact point execution ended — function name, step, partial edit in progress)

## What Needs To Happen Next
(imperative instructions specific enough for a cold agent to continue without context)

## Resume Prompt
(a complete, self-contained instruction the next agent can receive verbatim to continue the work)

Preserve file paths, function names, type names, and API identifiers exactly as they appear.`;

export function buildDetectionPrompt(
  delta: string,
  sessionTitle: string,
): { system: string; userContent: string } {
  return {
    system: DETECTION_SYSTEM_PROMPT,
    userContent: `Session: ${sessionTitle}\n\nRecent output:\n${delta}`,
  };
}

export function buildCheckpointNarrativePrompt(
  rawBuffer: string,
  sessionTitle: string,
  goalHint?: string,
  previousSummary?: string,
): { system: string; userContent: string } {
  const goalLine = goalHint ? `\nSession goal: ${goalHint}\n` : '';
  const prevLine = previousSummary ? `\nPrevious Handoff Summary (incorporate this context to maintain the continuous story of the entire session history):\n${previousSummary}\n` : '';
  return {
    system: CHECKPOINT_SYSTEM_PROMPT,
    userContent: `Session: ${sessionTitle}${goalLine}${prevLine}\n\nRecent terminal output:\n${rawBuffer}`,
  };
}
