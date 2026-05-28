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
 *
 * Plan-generation format (used only during plan creation from a capable agent):
 *
 *   ###ORCHATERM_PLAN_START###
 *   [...JSON array of tasks...]
 *   ###ORCHATERM_PLAN_END###
 */

import { OrchestratorTaskOutput, AgentNeedsRequest } from '../types';

// ── Sentinel markers ────────────────────────────────────────────────────────────
export const SENTINEL_START = '###ORCHATERM_DONE###';
export const SENTINEL_END   = '###ORCHATERM_END###';

// ── Plan markers ────────────────────────────────────────────────────────────────
export const PLAN_START = '###ORCHATERM_PLAN_START###';
export const PLAN_END   = '###ORCHATERM_PLAN_END###';

// ── Needs markers ────────────────────────────────────────────────────────────────
export const NEEDS_START = '###ORCHATERM_NEEDS###';
export const NEEDS_END   = '###ORCHATERM_NEEDS_END###';

// ── ANSI stripping ──────────────────────────────────────────────────────────────

/**
 * Strips ANSI escape sequences and non-printable control characters from a
 * string. Terminal output from Claude Code, Antigravity, etc. contains heavy
 * ANSI formatting that must be removed before Ollama processes the text.
 */
export function stripAnsiCodes(text: string): string {
  return text
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
  const raw   = buffer.slice(0, startIdx).trim();

  const taskId       = extractField(block, 'task_id');
  const summary      = extractField(block, 'summary');
  const filesRaw     = extractField(block, 'files_modified');
  const needs        = extractField(block, 'needs');

  const filesModified = filesRaw.toLowerCase() === 'none' || filesRaw === ''
    ? []
    : filesRaw.split(',').map(f => f.trim()).filter(Boolean);

  // Reject echoed dispatch template — placeholder fields start with '<'.
  // PTY line-wrapping can split '<2-3 sentences' across lines so we guard on
  // any field that starts with '<' (all template placeholders use that form).
  if (summary.startsWith('<') || needs.startsWith('<') || filesRaw.startsWith('<')) return null;

  return { raw, taskId, summary, filesModified, needs };
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

  const raw = clean.slice(startIdx + PLAN_START.length, endIdx).trim();

  // Strip markdown code fences if present
  let json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Bracket-match backward from the last ] to find the last outermost array.
  // Using indexOf+lastIndexOf fails when the agent outputs two arrays (e.g. due
  // to a duplicate prompt) because it spans both: "[…][…]" → parse error.
  // Scanning backward gives us only the last complete top-level array.
  const lastClose = json.lastIndexOf(']');
  if (lastClose !== -1) {
    let depth     = 0;
    let outerOpen = -1;
    for (let i = lastClose; i >= 0; i--) {
      if      (json[i] === ']') depth++;
      else if (json[i] === '[') { depth--; if (depth === 0) { outerOpen = i; break; } }
    }
    if (outerOpen !== -1) {
      json = json.slice(outerOpen, lastClose + 1);
    } else {
      // No matching [ found — the outer [ was consumed by a PTY ANSI artifact
      // (e.g. the [ in \x1b[9m[ was treated as the CSI introducer, stripped,
      // leaving only "9 {…}"). Reconstruct by wrapping first…last object in [].
      const firstBrace = json.indexOf('{');
      const lastBrace  = json.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace >= firstBrace) {
        json = '[' + json.slice(firstBrace, lastBrace + 1) + ']';
      }
    }
  }

  return json || null;
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

  const block   = clean.slice(startIdx + NEEDS_START.length, endIdx).trim();
  const ask     = extractField(block, 'ask');
  const context = extractField(block, 'context');

  if (!ask) return null;
  return { ask, context };
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
  // Normalize PTY line-wrap sequences (\r\n injected every ~80 terminal columns).
  // Remove \r\n entirely — when a wrap lands mid-token (e.g. "d\r\nependsOn")
  // concatenating gives the correct token ("dependsOn"); when it lands between
  // tokens the surrounding whitespace/comma still separates them correctly.
  // Bare \r → remove. Bare \n → space (safe JSON whitespace between tokens).
  let sanitised = rawJson.replace(/\r\n/g, '').replace(/\r/g, '').replace(/\n/g, ' ');

  // Strip trailing commas before } or ] — common in LLM output, invalid in JSON
  sanitised = sanitised.replace(/,\s*([}\]])/g, '$1');

  // Strip PTY-injected characters between the opening [ and the first { or nested [.
  // Incomplete ANSI escape sequences leave digit/symbol residue, e.g. "[9 {..." from
  // \x1b[ being consumed by the lone-ESC stripper leaving the "9" behind.
  sanitised = sanitised.replace(/^\[\s*[^{\[]*(?=[{\[])/, '[');

  // If the outer [ is still missing (consumed entirely by a PTY ANSI artifact),
  // reconstruct by wrapping from the first { to the last }.
  if (!sanitised.trimStart().startsWith('[')) {
    const firstBrace = sanitised.indexOf('{');
    const lastBrace  = sanitised.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace >= firstBrace) {
      sanitised = '[' + sanitised.slice(firstBrace, lastBrace + 1) + ']';
    }
  }

  // Fix missing opening quotes on property names — a PTY artifact where ANSI sequences
  // around keys eat the opening " character, producing:  ,title":  instead of  ,"title":
  // Pattern: after , or { (with optional whitespace), an unquoted identifier, then "  :
  sanitised = sanitised.replace(/([,{]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)("\s*:)/g, '$1"$2$3');

  // Fix unescaped backslashes in string values — common when the agent embeds
  // Windows paths (e.g. C:\Users\foo). Valid JSON escape sequences after \ are:
  // " \ / b f n r t u — anything else is illegal. Escape bare backslashes.
  sanitised = sanitised.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');

  const parsed = JSON.parse(sanitised);
  if (!Array.isArray(parsed)) throw new Error('Plan JSON must be an array');

  return parsed.map((item: any, i: number) => {
    if (typeof item.id          !== 'string') throw new Error(`Task ${i}: missing id`);
    if (typeof item.title       !== 'string') throw new Error(`Task ${i}: missing title`);
    if (typeof item.description !== 'string') throw new Error(`Task ${i}: missing description`);
    if (typeof item.assignedSessionId !== 'string') throw new Error(`Task ${i}: missing assignedSessionId`);

    // dependsOn: normalize defensively — PTY artifacts can corrupt the key name
    // (e.g. "ependsOn", "d ependsOn") or the agent may output a string instead
    // of an array ("none", "[]", "task-1, task-2"). Default to [] when unresolvable.
    const rawDep =
      item.dependsOn    ??  // correct key
      item.ependsOn     ??  // PTY drop of first char: "dependsOn" → "ependsOn"
      item['d ependsOn'] ?? // PTY mid-token space: "d\r\nependsOn" → "d ependsOn"
      [];
    const dependsOn: string[] = Array.isArray(rawDep)
      ? rawDep.map(String)
      : typeof rawDep === 'string'
        ? (rawDep.toLowerCase() === 'none' || rawDep === ''
            ? []
            : rawDep.replace(/[\[\]"]/g, '').split(',').map((s: string) => s.trim()).filter(Boolean))
        : [];

    return {
      id:                item.id,
      title:             item.title,
      description:       item.description,
      assignedSessionId: item.assignedSessionId,
      dependsOn,
    };
  });
}
