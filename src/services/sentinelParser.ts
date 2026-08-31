/**
 * sentinelParser.ts
 *
 * Pure functions for detecting and parsing the Orchaterm sentinel block that
 * agents output when they complete a task, and for stripping ANSI escape codes
 * from raw terminal output before it is processed by Ollama or displayed.
 *
 * Sentinel format agents must output:
 *
 *   ###ORCHATERM_DONE###
 *   task_id: <id>
 *   summary: <2-3 sentences>
 *   files_modified: <comma list, or "none">
 *   needs: <what next agent needs, or "none">
 *   ###ORCHATERM_END###
 */

import { OrchestratorTaskOutput, AgentNeedsRequest } from '../types';

// ── Sentinel markers ────────────────────────────────────────────────────────────
export const SENTINEL_START = '###ORCHATERM_DONE###';
export const SENTINEL_END = '###ORCHATERM_END###';

// ── Needs markers ────────────────────────────────────────────────────────────────
export const NEEDS_START = '###ORCHATERM_NEEDS###';
export const NEEDS_END = '###ORCHATERM_NEEDS_END###';

// ── ANSI stripping ──────────────────────────────────────────────────────────────

/**
 * Strips ANSI escape sequences and non-printable control characters from a
 * string. Terminal output from Claude Code, Antigravity, etc. contains heavy
 * ANSI formatting that must be removed before Ollama processes the text.
 */
export function stripAnsiCodes(text: string): string {
  return (
    text
      // CSI sequences: ESC [ ... letter  (colours, cursor movement, etc.)
      // Extended form also allows intermediate bytes (0x20-0x2F) before the final byte.
      .replace(/\x1b\[[0-9;?]*[ -/]*[A-Za-z@-~]/g, '')
      // OSC sequences: ESC ] ... BEL  (window title, hyperlinks, etc.)
      .replace(/\x1b\][^\x07]*\x07/g, '')
      // OSC sequences terminated by ST (ESC \)
      .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
      // Remaining lone ESC followed by a single character
      .replace(/\x1b./g, '')
      // Non-printable control chars except \n, \r, \t
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  );
}

// ── Field extraction ────────────────────────────────────────────────────────────

/**
 * Extracts a named field from a sentinel block.
 * Lines are expected in the form:  fieldName: value
 * Returns an empty string if the field is not found.
 */
export function extractField(block: string, fieldName: string): string {
  const lines = block.split('\n');
  const knownFields = ['task_id', 'summary', 'files_modified', 'needs', 'ask', 'context'];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (key !== fieldName) continue;

    // Collect the first line value
    const parts = [line.slice(colonIdx + 1).trim()];

    // Collect continuation lines — lines that don't start a new known field
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) break;
      const nextColon = lines[j].indexOf(':');
      const nextKey = nextColon !== -1 ? lines[j].slice(0, nextColon).trim() : '';
      if (knownFields.includes(nextKey)) break;
      parts.push(next);
    }

    return parts.join(' ').trim();
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
export function parseSentinel(rawBuffer: string): OrchestratorTaskOutput | null {
  // Strip ANSI codes before searching — Claude Code wraps output in escape sequences
  // that can land within marker text, breaking a raw indexOf search.
  const buffer = stripAnsiCodes(rawBuffer);

  // Use the LAST complete sentinel block — the buffer contains the echoed prompt
  // template (with placeholder values) before the agent's real output. lastIndexOf
  // ensures we always parse the agent's actual sentinel, not the echo.
  const endIdx = buffer.lastIndexOf(SENTINEL_END);
  if (endIdx === -1) return null;

  const startIdx = buffer.lastIndexOf(SENTINEL_START, endIdx);
  if (startIdx === -1) return null;

  const block = buffer.slice(startIdx + SENTINEL_START.length, endIdx).trim();
  const raw = buffer.slice(0, startIdx).trim();

  const taskId = extractField(block, 'task_id');
  const summary = extractField(block, 'summary');
  const filesRaw = extractField(block, 'files_modified');
  const needs = extractField(block, 'needs');

  const filesModified =
    filesRaw.toLowerCase() === 'none' || filesRaw === ''
      ? []
      : filesRaw
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean);

  // Reject echoed dispatch template — placeholder fields start with '<'.
  // PTY line-wrapping can split '<2-3 sentences' across lines so we guard on
  // any field that starts with '<' (all template placeholders use that form).
  if (summary.startsWith('<') || needs.startsWith('<') || filesRaw.startsWith('<')) return null;

  return { raw, taskId, summary, filesModified, needs };
}

// ── Needs block parsing ─────────────────────────────────────────────────────────

/**
 * Scans a terminal buffer for a complete NEEDS block (the last one if multiple).
 * Returns null if no complete block is present yet.
 *
 * Agents output this block mid-task to request information from peer agents:
 *
 *   ###ORCHATERM_NEEDS###
 *   ask: <question>
 *   context: <what the agent is currently working on>
 *   ###ORCHATERM_NEEDS_END###
 */
export function parseNeedsBlock(buffer: string): AgentNeedsRequest | null {
  const clean = stripAnsiCodes(buffer);

  // Use the LAST complete block so repeated needs don't re-trigger old requests.
  const endIdx = clean.lastIndexOf(NEEDS_END);
  if (endIdx === -1) return null;

  const startIdx = clean.lastIndexOf(NEEDS_START, endIdx);
  if (startIdx === -1) return null;

  const block = clean.slice(startIdx + NEEDS_START.length, endIdx).trim();
  const ask = extractField(block, 'ask');
  const context = extractField(block, 'context');

  if (!ask) return null;
  return { ask, context };
}
