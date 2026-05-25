/**
 * sentinelParser.ts
 *
 * Pure functions for detecting and parsing the AgentDeck sentinel block that
 * agents output when they complete a task, and for stripping ANSI escape codes
 * from raw terminal output before it is processed by Ollama or displayed.
 *
 * Sentinel format agents must output:
 *
 *   ###AGENTDECK_DONE###
 *   task_id: <id>
 *   summary: <2-3 sentences>
 *   files_modified: <comma list, or "none">
 *   needs: <what next agent needs, or "none">
 *   ###AGENTDECK_END###
 *
 * Plan-generation format (used only during plan creation from a capable agent):
 *
 *   ###AGENTDECK_PLAN_START###
 *   [...JSON array of tasks...]
 *   ###AGENTDECK_PLAN_END###
 */

import { OrchestratorTaskOutput } from '../types';

// ── Sentinel markers ────────────────────────────────────────────────────────────
export const SENTINEL_START = '###AGENTDECK_DONE###';
export const SENTINEL_END   = '###AGENTDECK_END###';

// ── Plan markers ────────────────────────────────────────────────────────────────
export const PLAN_START = '###AGENTDECK_PLAN_START###';
export const PLAN_END   = '###AGENTDECK_PLAN_END###';

// ── ANSI stripping ──────────────────────────────────────────────────────────────

/**
 * Strips ANSI escape sequences and non-printable control characters from a
 * string. Terminal output from Claude Code, Antigravity, etc. contains heavy
 * ANSI formatting that must be removed before Ollama processes the text.
 */
export function stripAnsiCodes(text: string): string {
  return text
    // CSI sequences: ESC [ ... letter  (colours, cursor movement, etc.)
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    // OSC sequences: ESC ] ... BEL  (window title, hyperlinks, etc.)
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // OSC sequences terminated by ST (ESC \)
    .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
    // Remaining lone ESC followed by a single character
    .replace(/\x1b./g, '')
    // Non-printable control chars except \n, \r, \t
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// ── Field extraction ────────────────────────────────────────────────────────────

/**
 * Extracts a named field from a sentinel block.
 * Lines are expected in the form:  fieldName: value
 * Returns an empty string if the field is not found.
 */
export function extractField(block: string, fieldName: string): string {
  const lines = block.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (key === fieldName) {
      return line.slice(colonIdx + 1).trim();
    }
  }
  return '';
}

// ── Sentinel parsing ────────────────────────────────────────────────────────────

/**
 * Scans a raw terminal buffer for a complete sentinel block.
 *
 * Returns null if no complete sentinel is found yet (the block might still be
 * arriving in chunks — keep accumulating and calling this function).
 *
 * Returns an OrchestratorTaskOutput if a complete block is found. The `raw`
 * field contains everything before the sentinel start marker, stripped of ANSI.
 */
export function parseSentinel(buffer: string): OrchestratorTaskOutput | null {
  const startIdx = buffer.indexOf(SENTINEL_START);
  if (startIdx === -1) return null;

  const endIdx = buffer.indexOf(SENTINEL_END, startIdx);
  if (endIdx === -1) return null; // block not yet complete — keep buffering

  // Everything between the markers (exclusive)
  const block = buffer.slice(startIdx + SENTINEL_START.length, endIdx).trim();

  // Raw working output is everything before the sentinel start
  const raw = stripAnsiCodes(buffer.slice(0, startIdx)).trim();

  const taskId        = extractField(block, 'task_id');
  const summary       = extractField(block, 'summary');
  const filesRaw      = extractField(block, 'files_modified');
  const needs         = extractField(block, 'needs');

  const filesModified = filesRaw.toLowerCase() === 'none' || filesRaw === ''
    ? []
    : filesRaw.split(',').map(f => f.trim()).filter(Boolean);

  return {
    raw,
    taskId,
    summary,
    filesModified,
    needs,
  };
}

// ── Plan JSON parsing ───────────────────────────────────────────────────────────

/**
 * Scans a buffer for a complete plan JSON block (used during plan generation
 * from a capable agent). Returns the clean JSON string if found, or null if the
 * block is not yet complete.
 *
 * Design notes:
 * - Strip ANSI first — Claude's PTY output is heavily decorated.
 * - Use lastIndexOf for PLAN_END so we always pick up Claude's *actual*
 *   response rather than any markers that appear in the echoed prompt or in
 *   Claude's own preamble / commentary.
 */
export function parsePlanBlock(buffer: string): string | null {
  // Work on ANSI-clean text so escape codes don't disrupt marker detection.
  const clean = stripAnsiCodes(buffer);

  // Find the last complete END marker — this is always Claude's real output.
  const endIdx = clean.lastIndexOf(PLAN_END);
  if (endIdx === -1) return null;

  // Find the last START marker that precedes this END.
  const startIdx = clean.lastIndexOf(PLAN_START, endIdx);
  if (startIdx === -1) return null;

  return clean.slice(startIdx + PLAN_START.length, endIdx).trim();
}

/**
 * Validates that a string is a JSON array whose items have at minimum
 * the required task fields. Returns the parsed array or throws.
 */
export function validatePlanJSON(rawJson: string): Array<{
  id: string;
  title: string;
  description: string;
  assignedSessionId: string;
  dependsOn: string[];
}> {
  const parsed = JSON.parse(rawJson);
  if (!Array.isArray(parsed)) throw new Error('Plan JSON must be an array');

  return parsed.map((item: any, i: number) => {
    if (typeof item.id          !== 'string') throw new Error(`Task ${i}: missing id`);
    if (typeof item.title       !== 'string') throw new Error(`Task ${i}: missing title`);
    if (typeof item.description !== 'string') throw new Error(`Task ${i}: missing description`);
    if (typeof item.assignedSessionId !== 'string') throw new Error(`Task ${i}: missing assignedSessionId`);
    if (!Array.isArray(item.dependsOn)) throw new Error(`Task ${i}: dependsOn must be an array`);
    return {
      id:                item.id,
      title:             item.title,
      description:       item.description,
      assignedSessionId: item.assignedSessionId,
      dependsOn:         item.dependsOn,
    };
  });
}
