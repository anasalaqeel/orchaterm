# Session Continuation System — Design Spec
**Date:** 2026-05-30  
**Status:** Approved

## Problem

Coding agents (Claude Code, Aider, etc.) running in orchaterm terminal sessions hit token/context limits mid-task. When this happens, all progress context is lost and there is no way to resume. The orchestrator needs to detect these events, preserve a structured snapshot of what happened, and inject a resume prompt into a new or existing terminal session.

---

## Architecture

### New Files

| File | Role |
|---|---|
| `src/services/sessionContinuationService.ts` | Core singleton service. Watches sessions via `bufferWatcher.watchForSummary()`, runs detection LLM, triggers checkpoints, manages injection flow |
| `src/services/checkpointGenerator.ts` | Pure async function: takes session buffer + metadata + LLM provider → produces hybrid `.md` checkpoint file on disk |
| `src/services/continuationPrompts.ts` | Prompt builders for detection LLM and checkpoint narrative LLM (mirrors `ollamaRelay.ts` pattern) |
| `src/types/continuation.types.ts` | `CheckpointSnapshot`, `ContinuationConfig`, `DetectionEvent`, `DetectionLabel` |

### Modified Files

| File | Change |
|---|---|
| `src/types/index.ts` | Re-export new types |
| `src/pages/Settings.tsx` | Add "Session Continuation" config section |
| `src/context/DashboardContext.tsx` | Wire service start/stop, surface `DetectionEvent` to UI |
| `src/components/conductor/ConductorLog.tsx` | Handle new `'checkpoint'` log entry type |

---

## Data Flow

```
PTY data → bufferWatcher (summary mode)
               ↓ debounced delta (800ms / 60 chars — existing)
    SessionContinuationService.onDelta(sessionId, delta)
               ↓
    Detection LLM: classify as PROGRESS | STALLED | LIMIT_HIT | STOPPED | TASK_COMPLETE
               ↓ LIMIT_HIT or STOPPED (confirmed 2× consecutive OR corroborated by idle shell)
    checkpointGenerator.generate(buffer, sessionMeta, llmProvider)
               ↓
    Writes .md file → {workspaceDir}/.orchaterm/checkpoints/{title}-{ts}.md
               ↓
    Emit DetectionEvent → DashboardContext → UI
               ↓ (per ContinuationConfig.mode)
    auto   → inject immediately into targetSessionId (or fall back to modal if null)
    semi   → show session-picker modal, user clicks Inject
    file-only → toast with file path only
```

---

## Detection Logic

### LLM Classification Prompt

Runs on every summary debounce cycle. Classifies the latest output delta as exactly one of:

- `PROGRESS` — agent actively working, no action needed  
- `STALLED` — agent paused/waiting for input (not a limit)  
- `LIMIT_HIT` — token/context/usage limit reached  
- `STOPPED` — agent exited or crashed unexpectedly  
- `TASK_COMPLETE` — agent finished on its own  

Returns the label + optional one-line reason. Tiny response — cheap call.

### Multi-Signal Confirmation

Single LLM classification does not trigger action alone:

- `LIMIT_HIT` or `STOPPED` must appear **2 consecutive debounce cycles** before triggering checkpoint
- `bufferWatcher.watchForIdle()` acts as corroborating signal — if LLM says `LIMIT_HIT` AND terminal returns to shell prompt → high confidence, trigger immediately (skip 2× requirement)
- Manual "Capture Now" button always bypasses detection logic

### Periodic Snapshots

Every `ContinuationConfig.snapshotIntervalChars` new characters (default: 4000), a lightweight snapshot is written regardless of detection state. These are progress breadcrumbs — not full checkpoints. Stored in same directory, prefixed `snapshot-`.

---

## Checkpoint File Format

**Path:** `{workspaceDir}/.orchaterm/checkpoints/{sessionTitle}-{ISOtimestamp}.md`

```markdown
# Checkpoint: {sessionTitle}
**Generated:** {ISO timestamp}
**Session Goal:** {goal — from conductor plan context or LLM-inferred from buffer}
**Status:** LIMIT_HIT | STOPPED | MANUAL

## What Was Done
{LLM narrative: 150–300 words, past tense, specific — what was built/changed}

## Files Modified
- path/to/file.ts — one-line description of change

## Decisions Made
{LLM-extracted key decisions, tradeoffs chosen, patterns used}

## Where It Stopped
{Exact stopping point — function name, feature step, line/block if identifiable}

## What Needs To Happen Next
{Imperative continuation instructions, specific enough for a cold agent}

## Resume Prompt
{Verbatim text to inject into the next agent session}

---
_Raw output tail (last 3000 chars, ANSI-stripped):_
{raw terminal output}
```

---

## Types

```ts
// continuation.types.ts

export type DetectionLabel = 'PROGRESS' | 'STALLED' | 'LIMIT_HIT' | 'STOPPED' | 'TASK_COMPLETE';

export interface ContinuationConfig {
  enabled: boolean;
  targetSessionId: string | null;       // null = ask on detection
  mode: 'auto' | 'semi' | 'file-only';
  snapshotIntervalChars: number;         // default 4000
  detectionProvider: LLMProvider;        // can differ from relay provider
  checkpointProvider: LLMProvider;       // for narrative generation
}

export interface CheckpointSnapshot {
  id: string;
  sessionId: string;
  sessionTitle: string;
  filePath: string;
  triggeredBy: 'auto-detection' | 'manual' | 'periodic';
  label: DetectionLabel;
  createdAt: number;
}

export interface DetectionEvent {
  type: 'checkpoint-written' | 'detection-update';
  sessionId: string;
  sessionTitle: string;
  label: DetectionLabel;
  snapshot?: CheckpointSnapshot;
}
```

---

## Injection Flow

1. Checkpoint file written to disk
2. `SessionContinuationService` emits `DetectionEvent`
3. Per `ContinuationConfig.mode`:
   - `file-only` → toast: "Checkpoint saved: {path}" — done
   - `semi` → modal: session picker dropdown + "Inject" / "Dismiss" buttons
   - `auto` → if `targetSessionId` set → inject immediately; if null → fall back to `semi` modal
4. Injected text = `## Resume Prompt` section from checkpoint file, prepended with:
   ```
   Continue working on the following task. A previous agent session stopped mid-way.
   Here is the full context of what happened and what needs to happen next:
   ```
5. Uses existing `writePtyChunked(targetSessionId, text + '\r')` — same as conductor dispatch

---

## UI Changes

### Settings Page
New "Session Continuation" section:
- Enable/disable toggle
- Mode selector: Auto / Semi-automatic / File only
- Default target session (dropdown of open sessions, or "Ask each time")
- Snapshot interval (chars slider, default 4000)
- LLM provider selector for detection and checkpoint generation

### Toast Notification
Fires on `checkpoint-written` event:
- Message: "Agent stopped — checkpoint saved"
- Action button: "Resume" (triggers injection modal if mode is semi/auto-without-target)

### Session Picker Modal
Appears when target session not pre-configured:
- Lists open terminal sessions with titles and current status
- Single-select
- "Inject & Resume" primary action, "Save File Only" secondary

### Conductor Log
New entry type `'checkpoint'` in existing log panel:
- Shows session title, detection label, file path (clickable to open in OS file manager)

### Terminal Tab Header
Small snapshot indicator icon (non-intrusive) that briefly pulses when a periodic snapshot is written.

---

## Error Handling

- Detection LLM fails → silently skip that cycle, try next debounce
- Checkpoint LLM fails → write partial checkpoint with raw buffer only, mark as `partial: true`
- File write fails → emit error toast, do not inject (no silent data loss)
- Injection fails → show error in conductor log, offer retry

---

## Testing

- Unit test `continuationPrompts.ts`: given sample terminal output, LLM prompt produces correct structure
- Unit test `checkpointGenerator.ts`: given mocked LLM + buffer, output file matches schema
- Unit test detection confirmation logic: 2× consecutive rule, idle corroboration
- Integration test: full flow from buffer delta → detection → file write → injection (mock PTY + mock LLM)
