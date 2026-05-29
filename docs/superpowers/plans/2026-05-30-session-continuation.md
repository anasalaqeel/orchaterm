# Session Continuation System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a system that monitors coding-agent terminal sessions, detects token/context limit events via LLM classification, generates structured hybrid checkpoint files, and injects resume prompts into a user-selected session.

**Architecture:** A new `SessionContinuationService` (mirrors `autonomousOrchestrator.ts`) subscribes to `bufferWatcher.watchForSummary()` per session, runs a dedicated detection LLM on each debounced delta, and triggers `checkpointGenerator.ts` when a stop event is confirmed. A new Rust command `write_file_path` handles writing checkpoint markdown files to arbitrary workspace paths. The UI wires events to a toast notification and a session-picker modal for injection.

**Tech Stack:** TypeScript, Vitest, React, Emotion CSS, Tauri (Rust), `@tauri-apps/api/core`, existing `bufferWatcher` + `LLMProvider` abstractions.

---

## File Map

**Create:**
- `src/types/continuation.types.ts` — `DetectionLabel`, `ContinuationConfig`, `CheckpointSnapshot`, `DetectionEvent`
- `src/services/continuationPrompts.ts` — detection LLM prompt + checkpoint narrative prompt builders
- `src/services/checkpointGenerator.ts` — generates and writes `.md` checkpoint file
- `src/services/sessionContinuationService.ts` — core singleton service
- `src/components/ui/ContinuationModal.tsx` — session-picker modal for injection
- `src/tests/sessionContinuationService.test.ts` — service unit tests
- `src/tests/checkpointGenerator.test.ts` — generator unit tests
- `src/tests/continuationPrompts.test.ts` — prompt shape tests

**Modify:**
- `src-tauri/src/lib.rs` — add `write_file_path` Tauri command
- `src/types/index.ts` — re-export continuation types
- `src/types/workspace.types.ts` — add `continuation` field to `AppSettings`
- `src/context/DashboardContext.tsx` — wire service, surface `DetectionEvent` to UI
- `src/types/conductor.types.ts` — add `'checkpoint'` to `ConductorLogEntry['type']`
- `src/components/conductor/ConductorLog.tsx` — render checkpoint log entries
- `src/pages/Settings.tsx` — add Session Continuation settings section
- `src/components/ui/index.ts` — re-export `ContinuationModal`

---

## Task 1: Continuation Types

**Files:**
- Create: `src/types/continuation.types.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/types/continuation.types.ts

export type DetectionLabel =
  | 'PROGRESS'
  | 'STALLED'
  | 'LIMIT_HIT'
  | 'STOPPED'
  | 'TASK_COMPLETE';

export type ContinuationMode = 'auto' | 'semi' | 'file-only';

export interface ContinuationConfig {
  enabled: boolean;
  /** Session ID to inject into on detection. null = ask user each time. */
  targetSessionId: string | null;
  mode: ContinuationMode;
  /** Generate a periodic snapshot every N new buffer characters. Default: 4000. */
  snapshotIntervalChars: number;
}

export interface CheckpointSnapshot {
  id: string;
  sessionId: string;
  sessionTitle: string;
  /** Absolute path to the written .md file. */
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
  /** Present only when type === 'checkpoint-written'. */
  snapshot?: CheckpointSnapshot;
}
```

- [ ] **Step 2: Re-export from the type barrel**

Open `src/types/index.ts` and add this line at the end:

```typescript
export * from './continuation.types';
```

- [ ] **Step 3: Commit**

```bash
git add src/types/continuation.types.ts src/types/index.ts
git commit -m "feat(types): add continuation types"
```

---

## Task 2: Prompt Builders

**Files:**
- Create: `src/services/continuationPrompts.ts`
- Create: `src/tests/continuationPrompts.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/continuationPrompts.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildDetectionPrompt,
  buildCheckpointNarrativePrompt,
} from '../services/continuationPrompts';

describe('buildDetectionPrompt', () => {
  it('returns system and userContent strings', () => {
    const { system, userContent } = buildDetectionPrompt(
      'Claude Code: usage limit reached',
      'Claude'
    );
    expect(typeof system).toBe('string');
    expect(typeof userContent).toBe('string');
    expect(system.length).toBeGreaterThan(20);
    expect(userContent).toContain('Claude Code: usage limit reached');
  });

  it('includes session title in user content', () => {
    const { userContent } = buildDetectionPrompt('some output', 'Aider');
    expect(userContent).toContain('Aider');
  });
});

describe('buildCheckpointNarrativePrompt', () => {
  it('returns system and userContent strings', () => {
    const { system, userContent } = buildCheckpointNarrativePrompt(
      'terminal output here',
      'Claude',
      'Build an auth system'
    );
    expect(typeof system).toBe('string');
    expect(typeof userContent).toBe('string');
    expect(userContent).toContain('terminal output here');
  });

  it('includes goal hint when provided', () => {
    const { userContent } = buildCheckpointNarrativePrompt(
      'output',
      'Claude',
      'Build auth'
    );
    expect(userContent).toContain('Build auth');
  });

  it('works without goal hint', () => {
    const { system, userContent } = buildCheckpointNarrativePrompt('output', 'Claude');
    expect(typeof system).toBe('string');
    expect(typeof userContent).toBe('string');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test src/tests/continuationPrompts.test.ts
```

Expected: FAIL — `Cannot find module '../services/continuationPrompts'`

- [ ] **Step 3: Create the prompt builders**

```typescript
// src/services/continuationPrompts.ts

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
): { system: string; userContent: string } {
  const goalLine = goalHint ? `\nSession goal: ${goalHint}\n` : '';
  return {
    system: CHECKPOINT_SYSTEM_PROMPT,
    userContent: `Session: ${sessionTitle}${goalLine}\n\nTerminal output:\n${rawBuffer}`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/tests/continuationPrompts.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/continuationPrompts.ts src/tests/continuationPrompts.test.ts
git commit -m "feat(continuation): add detection and checkpoint prompt builders"
```

---

## Task 3: Rust — `write_file_path` Command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the Tauri command**

Open `src-tauri/src/lib.rs`. After the `save_store` function (around line 491), add:

```rust
#[tauri::command]
fn write_file_path(path: String, content: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create directory: {e}"))?;
    }
    std::fs::write(p, &content).map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}
```

- [ ] **Step 2: Register the command in the invoke handler**

Find the `invoke_handler` call (around line 504). Add `write_file_path` to the handler list:

```rust
.invoke_handler(tauri::generate_handler![
    get_available_shells,
    spawn_pty,
    write_pty,
    resize_pty,
    kill_pty,
    load_store,
    save_store,
    write_file_path
])
```

- [ ] **Step 3: Build to verify it compiles**

```bash
cd src-tauri && cargo build 2>&1 | tail -5
```

Expected: `Finished dev [unoptimized + debuginfo] target(s)` (no errors)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tauri): add write_file_path command for checkpoint file I/O"
```

---

## Task 4: Checkpoint Generator

**Files:**
- Create: `src/services/checkpointGenerator.ts`
- Create: `src/tests/checkpointGenerator.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/checkpointGenerator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCheckpoint } from '../services/checkpointGenerator';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/continuationPrompts', () => ({
  buildCheckpointNarrativePrompt: vi.fn().mockReturnValue({
    system: 'sys',
    userContent: 'user',
  }),
}));

vi.mock('../services/sentinelParser', () => ({
  stripAnsiCodes: vi.fn((s: string) => s),
}));

const mockLlm = {
  complete: vi.fn().mockResolvedValue(
    '## What Was Done\nBuilt auth module.\n\n## Files Modified\n- src/auth.ts — added JWT logic\n\n## Decisions Made\nUsed HS256.\n\n## Where It Stopped\nHalfway through refresh token.\n\n## What Needs To Happen Next\nFinish refresh token endpoint.\n\n## Resume Prompt\nContinue building the refresh token endpoint in src/auth.ts.'
  ),
  stream: vi.fn(),
  listModels: vi.fn().mockResolvedValue([]),
  checkOnline: vi.fn().mockResolvedValue(true),
};

describe('generateCheckpoint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a CheckpointSnapshot with correct shape', async () => {
    const snapshot = await generateCheckpoint(
      {
        sessionId: 'sess-1',
        sessionTitle: 'Claude',
        rawBuffer: 'some terminal output',
        workspacePath: '/home/user/myproject',
        triggeredBy: 'auto-detection',
        label: 'LIMIT_HIT',
      },
      mockLlm,
    );

    expect(snapshot.sessionId).toBe('sess-1');
    expect(snapshot.sessionTitle).toBe('Claude');
    expect(snapshot.triggeredBy).toBe('auto-detection');
    expect(snapshot.label).toBe('LIMIT_HIT');
    expect(snapshot.filePath).toContain('.orchaterm/checkpoints');
    expect(snapshot.filePath).toContain('Claude');
    expect(typeof snapshot.id).toBe('string');
    expect(typeof snapshot.createdAt).toBe('number');
  });

  it('calls invoke with write_file_path', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    await generateCheckpoint(
      {
        sessionId: 'sess-1',
        sessionTitle: 'Claude',
        rawBuffer: 'output',
        workspacePath: '/home/user/myproject',
        triggeredBy: 'manual',
        label: 'STOPPED',
      },
      mockLlm,
    );
    expect(invoke).toHaveBeenCalledWith('write_file_path', expect.objectContaining({
      path: expect.stringContaining('.orchaterm/checkpoints'),
      content: expect.stringContaining('# Checkpoint: Claude'),
    }));
  });

  it('writes partial checkpoint when LLM fails', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const failingLlm = {
      ...mockLlm,
      complete: vi.fn().mockRejectedValue(new Error('LLM offline')),
    };
    await generateCheckpoint(
      {
        sessionId: 'sess-1',
        sessionTitle: 'Claude',
        rawBuffer: 'output',
        workspacePath: '/home/user/proj',
        triggeredBy: 'manual',
        label: 'STOPPED',
      },
      failingLlm,
    );
    const call = vi.mocked(invoke).mock.calls[0];
    expect((call[1] as any).content).toContain('LLM unavailable');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test src/tests/checkpointGenerator.test.ts
```

Expected: FAIL — `Cannot find module '../services/checkpointGenerator'`

- [ ] **Step 3: Create the checkpoint generator**

```typescript
// src/services/checkpointGenerator.ts
import { invoke } from '@tauri-apps/api/core';
import { stripAnsiCodes } from './sentinelParser';
import { buildCheckpointNarrativePrompt } from './continuationPrompts';
import type { LLMProvider } from './llm';
import type { CheckpointSnapshot, DetectionLabel } from '../types';

const RAW_TAIL_CHARS = 3000;

export interface CheckpointInput {
  sessionId: string;
  sessionTitle: string;
  rawBuffer: string;
  workspacePath: string;
  triggeredBy: CheckpointSnapshot['triggeredBy'];
  label: DetectionLabel;
  goalHint?: string;
}

export async function generateCheckpoint(
  input: CheckpointInput,
  llmProvider: LLMProvider,
): Promise<CheckpointSnapshot> {
  const cleanBuffer = stripAnsiCodes(input.rawBuffer);

  let narrative = '';
  let partial = false;
  try {
    const { system, userContent } = buildCheckpointNarrativePrompt(
      cleanBuffer,
      input.sessionTitle,
      input.goalHint,
    );
    narrative = await llmProvider.complete([{ role: 'user', content: userContent }], system);
  } catch {
    partial = true;
    narrative = '(LLM unavailable — narrative could not be generated)';
  }

  const rawTail = cleanBuffer.slice(-RAW_TAIL_CHARS);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safeTitle = input.sessionTitle.replace(/[^a-zA-Z0-9-_]/g, '_');
  const fileName = `${safeTitle}-${ts}.md`;
  const dir = `${input.workspacePath}/.orchaterm/checkpoints`;
  const filePath = `${dir}/${fileName}`;

  const content = buildCheckpointMarkdown({
    sessionTitle: input.sessionTitle,
    label: input.label,
    narrative,
    rawTail,
    partial,
  });

  await invoke('write_file_path', { path: filePath, content });

  return {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    sessionTitle: input.sessionTitle,
    filePath,
    triggeredBy: input.triggeredBy,
    label: input.label,
    createdAt: Date.now(),
  };
}

function buildCheckpointMarkdown(opts: {
  sessionTitle: string;
  label: DetectionLabel;
  narrative: string;
  rawTail: string;
  partial: boolean;
}): string {
  return `# Checkpoint: ${opts.sessionTitle}
**Generated:** ${new Date().toISOString()}
**Status:** ${opts.label}${opts.partial ? ' _(partial — LLM unavailable)_' : ''}

${opts.narrative}

---
_Raw output tail (last ${RAW_TAIL_CHARS} chars):_

\`\`\`
${opts.rawTail}
\`\`\`
`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/tests/checkpointGenerator.test.ts
```

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/checkpointGenerator.ts src/tests/checkpointGenerator.test.ts
git commit -m "feat(continuation): add checkpoint generator"
```

---

## Task 5: SessionContinuationService

**Files:**
- Create: `src/services/sessionContinuationService.ts`
- Create: `src/tests/sessionContinuationService.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/sessionContinuationService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionContinuationService } from '../services/sessionContinuationService';

vi.mock('../services/bufferWatcher', () => ({
  bufferWatcher: {
    watchForSummary: vi.fn().mockResolvedValue(() => {}),
    watchForIdle: vi.fn().mockResolvedValue(() => {}),
    getBuffer: vi.fn().mockReturnValue('some terminal output'),
  },
}));

vi.mock('../services/continuationPrompts', () => ({
  buildDetectionPrompt: vi.fn().mockReturnValue({ system: '', userContent: 'detect?' }),
}));

vi.mock('../services/checkpointGenerator', () => ({
  generateCheckpoint: vi.fn().mockResolvedValue({
    id: 'snap-1',
    sessionId: 'sess-a',
    sessionTitle: 'Claude',
    filePath: '/proj/.orchaterm/checkpoints/Claude-ts.md',
    triggeredBy: 'auto-detection',
    label: 'LIMIT_HIT',
    createdAt: Date.now(),
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const mockProvider = {
  complete: vi.fn().mockResolvedValue('PROGRESS'),
  stream: vi.fn(),
  listModels: vi.fn().mockResolvedValue([]),
  checkOnline: vi.fn().mockResolvedValue(true),
};

const defaultConfig = {
  enabled: true,
  targetSessionId: null,
  mode: 'semi' as const,
  snapshotIntervalChars: 4000,
};

const defaultMeta = {
  id: 'sess-a',
  title: 'Claude',
  workspacePath: '/home/user/proj',
};

describe('SessionContinuationService', () => {
  let service: SessionContinuationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SessionContinuationService();
  });

  it('starts monitoring and registers summary + idle watchers', async () => {
    const { bufferWatcher } = await import('../services/bufferWatcher');
    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    expect(bufferWatcher.watchForSummary).toHaveBeenCalledWith('sess-a', expect.any(Function));
    expect(bufferWatcher.watchForIdle).toHaveBeenCalledWith('sess-a', expect.any(Function));
    expect(service.isMonitoring('sess-a')).toBe(true);
  });

  it('stops monitoring and removes session', async () => {
    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    service.stopMonitoring('sess-a');
    expect(service.isMonitoring('sess-a')).toBe(false);
  });

  it('does not start when config.enabled is false', async () => {
    const { bufferWatcher } = await import('../services/bufferWatcher');
    await service.startMonitoring(
      defaultMeta,
      { ...defaultConfig, enabled: false },
      mockProvider,
      mockProvider,
    );
    expect(bufferWatcher.watchForSummary).not.toHaveBeenCalled();
    expect(service.isMonitoring('sess-a')).toBe(false);
  });

  it('calls detection provider when a summary delta arrives', async () => {
    const capturedCallbacks: Array<(chunk: string) => void> = [];
    const { bufferWatcher } = await import('../services/bufferWatcher');
    vi.mocked(bufferWatcher.watchForSummary).mockImplementation(
      async (_id, onChunk) => {
        capturedCallbacks.push(onChunk);
        return () => {};
      }
    );

    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    if (capturedCallbacks[0]) await capturedCallbacks[0]('new output delta');
    expect(mockProvider.complete).toHaveBeenCalled();
  });

  it('emits detection-update event after classification', async () => {
    const capturedCallbacks: Array<(chunk: string) => void> = [];
    const { bufferWatcher } = await import('../services/bufferWatcher');
    vi.mocked(bufferWatcher.watchForSummary).mockImplementation(
      async (_id, onChunk) => { capturedCallbacks.push(onChunk); return () => {}; }
    );

    const events: any[] = [];
    service.onEvent(e => events.push(e));

    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    if (capturedCallbacks[0]) await capturedCallbacks[0]('delta');
    expect(events.some(e => e.type === 'detection-update')).toBe(true);
  });

  it('triggers checkpoint after 2 consecutive LIMIT_HIT classifications', async () => {
    const capturedCallbacks: Array<(chunk: string) => void> = [];
    const { bufferWatcher } = await import('../services/bufferWatcher');
    vi.mocked(bufferWatcher.watchForSummary).mockImplementation(
      async (_id, onChunk) => { capturedCallbacks.push(onChunk); return () => {}; }
    );
    mockProvider.complete.mockResolvedValue('LIMIT_HIT');

    const events: any[] = [];
    service.onEvent(e => events.push(e));

    const { generateCheckpoint } = await import('../services/checkpointGenerator');

    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    const cb = capturedCallbacks[0];
    if (cb) {
      await cb('delta 1');
      await cb('delta 2');
    }
    expect(generateCheckpoint).toHaveBeenCalledTimes(1);
    expect(events.some(e => e.type === 'checkpoint-written')).toBe(true);
  });

  it('does not trigger checkpoint on first LIMIT_HIT (needs 2 consecutive)', async () => {
    const capturedCallbacks: Array<(chunk: string) => void> = [];
    const { bufferWatcher } = await import('../services/bufferWatcher');
    vi.mocked(bufferWatcher.watchForSummary).mockImplementation(
      async (_id, onChunk) => { capturedCallbacks.push(onChunk); return () => {}; }
    );
    mockProvider.complete.mockResolvedValue('LIMIT_HIT');

    const { generateCheckpoint } = await import('../services/checkpointGenerator');

    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    if (capturedCallbacks[0]) await capturedCallbacks[0]('delta 1');
    expect(generateCheckpoint).not.toHaveBeenCalled();
  });

  it('captureNow triggers a manual checkpoint', async () => {
    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    const { generateCheckpoint } = await import('../services/checkpointGenerator');
    const snapshot = await service.captureNow('sess-a');
    expect(generateCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ triggeredBy: 'manual', sessionId: 'sess-a' }),
      mockProvider,
    );
    expect(snapshot).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test src/tests/sessionContinuationService.test.ts
```

Expected: FAIL — `Cannot find module '../services/sessionContinuationService'`

- [ ] **Step 3: Create the service**

```typescript
// src/services/sessionContinuationService.ts
import { bufferWatcher } from './bufferWatcher';
import { buildDetectionPrompt } from './continuationPrompts';
import { generateCheckpoint } from './checkpointGenerator';
import type { LLMProvider } from './llm';
import type { CheckpointSnapshot, ContinuationConfig, DetectionEvent, DetectionLabel } from '../types';

interface SessionMeta {
  id: string;
  title: string;
  workspacePath: string;
  goalHint?: string;
}

interface MonitoredSession {
  meta: SessionMeta;
  config: ContinuationConfig;
  detectionProvider: LLMProvider;
  checkpointProvider: LLMProvider;
  unsubscribeSummary?: () => void;
  unsubscribeIdle?: () => void;
  consecutiveStopCount: number;
  lastPeriodicSnapshotLength: number;
  checkpointInProgress: boolean;
}

export class SessionContinuationService {
  private sessions = new Map<string, MonitoredSession>();
  private eventListeners: Array<(event: DetectionEvent) => void> = [];

  onEvent(cb: (event: DetectionEvent) => void): () => void {
    this.eventListeners.push(cb);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== cb);
    };
  }

  async startMonitoring(
    meta: SessionMeta,
    config: ContinuationConfig,
    detectionProvider: LLMProvider,
    checkpointProvider: LLMProvider,
  ): Promise<void> {
    this.stopMonitoring(meta.id);
    if (!config.enabled) return;

    const entry: MonitoredSession = {
      meta,
      config,
      detectionProvider,
      checkpointProvider,
      consecutiveStopCount: 0,
      lastPeriodicSnapshotLength: 0,
      checkpointInProgress: false,
    };

    const unsubscribeSummary = await bufferWatcher.watchForSummary(
      meta.id,
      (delta) => { void this.onDelta(meta.id, delta); },
    );

    const unsubscribeIdle = await bufferWatcher.watchForIdle(
      meta.id,
      () => { void this.onIdleShell(meta.id); },
    );

    entry.unsubscribeSummary = unsubscribeSummary;
    entry.unsubscribeIdle = unsubscribeIdle;
    this.sessions.set(meta.id, entry);
  }

  stopMonitoring(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.unsubscribeSummary?.();
    entry.unsubscribeIdle?.();
    this.sessions.delete(sessionId);
  }

  isMonitoring(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async captureNow(sessionId: string): Promise<CheckpointSnapshot | null> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    return this.doCheckpoint(entry, 'manual', 'STOPPED');
  }

  private async onDelta(sessionId: string, delta: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.checkpointInProgress) return;

    // Periodic snapshot
    const buffer = bufferWatcher.getBuffer(sessionId);
    const charsSinceLast = buffer.length - entry.lastPeriodicSnapshotLength;
    if (charsSinceLast >= entry.config.snapshotIntervalChars) {
      entry.lastPeriodicSnapshotLength = buffer.length;
      void this.doCheckpoint(entry, 'periodic', 'PROGRESS');
    }

    // Detection
    let label: DetectionLabel = 'PROGRESS';
    try {
      const { system, userContent } = buildDetectionPrompt(delta, entry.meta.title);
      const response = await entry.detectionProvider.complete(
        [{ role: 'user', content: userContent }],
        system,
      );
      const trimmed = response.trim() as DetectionLabel;
      if (['PROGRESS', 'STALLED', 'LIMIT_HIT', 'STOPPED', 'TASK_COMPLETE'].includes(trimmed)) {
        label = trimmed;
      }
    } catch {
      return;
    }

    this.emit({ type: 'detection-update', sessionId, sessionTitle: entry.meta.title, label });

    if (label === 'LIMIT_HIT' || label === 'STOPPED') {
      entry.consecutiveStopCount++;
      if (entry.consecutiveStopCount >= 2) {
        entry.consecutiveStopCount = 0;
        await this.doCheckpoint(entry, 'auto-detection', label);
      }
    } else {
      entry.consecutiveStopCount = 0;
    }
  }

  private async onIdleShell(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.checkpointInProgress) return;
    if (entry.consecutiveStopCount > 0) {
      entry.consecutiveStopCount = 0;
      await this.doCheckpoint(entry, 'auto-detection', 'STOPPED');
    }
  }

  private async doCheckpoint(
    entry: MonitoredSession,
    triggeredBy: CheckpointSnapshot['triggeredBy'],
    label: DetectionLabel,
  ): Promise<CheckpointSnapshot | null> {
    entry.checkpointInProgress = true;
    try {
      const rawBuffer = bufferWatcher.getBuffer(entry.meta.id);
      const snapshot = await generateCheckpoint(
        {
          sessionId: entry.meta.id,
          sessionTitle: entry.meta.title,
          rawBuffer,
          workspacePath: entry.meta.workspacePath,
          triggeredBy,
          label,
          goalHint: entry.meta.goalHint,
        },
        entry.checkpointProvider,
      );
      this.emit({
        type: 'checkpoint-written',
        sessionId: entry.meta.id,
        sessionTitle: entry.meta.title,
        label,
        snapshot,
      });
      return snapshot;
    } catch {
      return null;
    } finally {
      entry.checkpointInProgress = false;
    }
  }

  private emit(event: DetectionEvent): void {
    for (const cb of this.eventListeners) cb(event);
  }
}

export const sessionContinuationService = new SessionContinuationService();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/tests/sessionContinuationService.test.ts
```

Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sessionContinuationService.ts src/tests/sessionContinuationService.test.ts
git commit -m "feat(continuation): add SessionContinuationService"
```

---

## Task 6: AppSettings Extension

**Files:**
- Modify: `src/types/workspace.types.ts`
- Modify: `src/context/DashboardContext.tsx`

- [ ] **Step 1: Add `continuation` to `AppSettings`**

In `src/types/workspace.types.ts`, add the `continuation` field to `AppSettings` (after `terminalConfig`):

```typescript
import type { ContinuationConfig } from './continuation.types';

// Inside AppSettings interface, add:
continuation?: ContinuationConfig;
```

The full addition goes after `terminalConfig?: TerminalConfig;`:

```typescript
  continuation?: ContinuationConfig;
```

Add the import at the top of the file (alongside the existing imports):

```typescript
import type { ContinuationConfig } from './continuation.types';
```

- [ ] **Step 2: Add default continuation config in `DashboardContext.tsx`**

In `src/context/DashboardContext.tsx`, find the `migrateSettings` function. In the block that handles `raw.llmProviders` (around line 111), add `continuation` to both return branches:

```typescript
continuation: raw.continuation ?? {
  enabled: false,
  targetSessionId: null,
  mode: 'semi',
  snapshotIntervalChars: 4000,
},
```

Add this line to **both** return objects in `migrateSettings` (the `raw.llmProviders` branch and the legacy branch). Example for the first branch:

```typescript
return {
  shellPath: raw.shellPath ?? '',
  conductorTaskTimeoutMinutes: raw.conductorTaskTimeoutMinutes ?? 0,
  conductorInteractionMode: raw.conductorInteractionMode ?? 'auto',
  llmProviders: { ... },
  llmProviderMode: raw.llmProviderMode ?? 'advanced',
  simpleLlmProvider: raw.simpleLlmProvider ?? ...,
  providerApiKeys: raw.providerApiKeys ?? {},
  terminalConfig: { ...DEFAULT_TERMINAL_CONFIG, ...(raw.terminalConfig ?? {}) },
  continuation: raw.continuation ?? {
    enabled: false,
    targetSessionId: null,
    mode: 'semi',
    snapshotIntervalChars: 4000,
  },
};
```

Also update the `useState` initial value for `settings` in `DashboardProvider` to include:

```typescript
continuation: {
  enabled: false,
  targetSessionId: null,
  mode: 'semi',
  snapshotIntervalChars: 4000,
},
```

- [ ] **Step 3: Build to verify TypeScript compiles**

```bash
bun run tsc --noEmit 2>&1 | head -20
```

Expected: No errors (or only pre-existing errors unrelated to continuation types)

- [ ] **Step 4: Commit**

```bash
git add src/types/workspace.types.ts src/context/DashboardContext.tsx
git commit -m "feat(continuation): add continuation config to AppSettings"
```

---

## Task 7: Wire Service into DashboardContext

**Files:**
- Modify: `src/context/DashboardContext.tsx`

- [ ] **Step 1: Add imports and state**

At the top of `src/context/DashboardContext.tsx`, add these imports:

```typescript
import { sessionContinuationService } from '../services/sessionContinuationService';
import type { DetectionEvent, CheckpointSnapshot } from '../types';
```

Add to `DashboardContextType` interface (after the `terminalSessions` block):

```typescript
// ── Session continuation ─────────────────────────────────────────────────────
lastCheckpoint: CheckpointSnapshot | null;
pendingInjectionSnapshot: CheckpointSnapshot | null;
setPendingInjectionSnapshot: (s: CheckpointSnapshot | null) => void;
captureSessionNow: (sessionId: string) => Promise<void>;
```

Add state to `DashboardProvider`:

```typescript
const [lastCheckpoint, setLastCheckpoint] = useState<CheckpointSnapshot | null>(null);
const [pendingInjectionSnapshot, setPendingInjectionSnapshot] = useState<CheckpointSnapshot | null>(null);
```

- [ ] **Step 2: Subscribe to continuation events**

Add this `useEffect` inside `DashboardProvider`, after the `terminalSessions` state (before the return):

```typescript
// ── Wire continuation service events to UI state ─────────────────────────────
useEffect(() => {
  return sessionContinuationService.onEvent((event: DetectionEvent) => {
    if (event.type !== 'checkpoint-written' || !event.snapshot) return;
    setLastCheckpoint(event.snapshot);
    const continuationCfg = settings.continuation;
    if (!continuationCfg?.enabled) return;
    if (continuationCfg.mode === 'file-only') {
      showToast(`Checkpoint saved: ${event.snapshot.sessionTitle}`, 'info');
      return;
    }
    // semi or auto — surface for injection
    setPendingInjectionSnapshot(event.snapshot);
  });
}, [settings.continuation]);
```

- [ ] **Step 3: Add `captureSessionNow` function**

Inside `DashboardProvider`, add this function (alongside the other action functions):

```typescript
const captureSessionNow = async (sessionId: string): Promise<void> => {
  const snapshot = await sessionContinuationService.captureNow(sessionId);
  if (snapshot) {
    setLastCheckpoint(snapshot);
    setPendingInjectionSnapshot(snapshot);
  }
};
```

- [ ] **Step 4: Expose in context value**

In the `value` object returned by `DashboardProvider`, add:

```typescript
lastCheckpoint,
pendingInjectionSnapshot,
setPendingInjectionSnapshot,
captureSessionNow,
```

- [ ] **Step 5: Build to verify TypeScript compiles**

```bash
bun run tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add src/context/DashboardContext.tsx
git commit -m "feat(continuation): wire SessionContinuationService into DashboardContext"
```

---

## Task 8: ConductorLog Checkpoint Entry

**Files:**
- Modify: `src/types/conductor.types.ts`
- Modify: `src/components/conductor/ConductorLog.tsx`

- [ ] **Step 1: Add `'checkpoint'` to `ConductorLogEntry['type']`**

In `src/types/conductor.types.ts`, find `ConductorLogEntry`:

```typescript
type: 'dispatch' | 'sentinel' | 'relay' | 'timeout' | 'error' | 'info' | 'user-override';
```

Change to:

```typescript
type: 'dispatch' | 'sentinel' | 'relay' | 'timeout' | 'error' | 'info' | 'user-override' | 'checkpoint';
```

Also add an optional field for checkpoint data:

```typescript
/** File path — present on 'checkpoint' entries only. */
checkpointPath?: string;
```

- [ ] **Step 2: Add checkpoint entry to `TYPE_META` in `ConductorLog.tsx`**

In `src/components/conductor/ConductorLog.tsx`, add this import at the top alongside the existing Lucide imports:

```typescript
import { Save } from 'lucide-react';
```

In `TYPE_META`, add:

```typescript
checkpoint: { icon: Save, label: 'CHECKPOINT', colorVar: '#34d399' },
```

- [ ] **Step 3: Build to verify TypeScript compiles**

```bash
bun run tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/types/conductor.types.ts src/components/conductor/ConductorLog.tsx
git commit -m "feat(continuation): add checkpoint entry type to conductor log"
```

---

## Task 9: Session Continuation Settings UI

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Find the insertion point**

In `src/pages/Settings.tsx`, locate the section that renders "Conductor" settings (search for `conductorInteractionMode` or `conductorTaskTimeoutMinutes`). The new section goes after this block.

- [ ] **Step 2: Add the Session Continuation section**

After the conductor settings section JSX, add:

```tsx
{/* ── Session Continuation ──────────────────────────────────────────────── */}
<div className={css`margin-top: 32px;`}>
  <h3 className={css`
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 16px;
  `}>
    Session Continuation
  </h3>

  {/* Enable toggle */}
  <div className={css`display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;`}>
    <div>
      <div className={css`font-size: 13px; color: var(--text-primary);`}>Enable session continuation</div>
      <div className={css`font-size: 12px; color: var(--text-tertiary); margin-top: 2px;`}>
        Detect when agents hit token limits and generate resume checkpoints
      </div>
    </div>
    <input
      type="checkbox"
      checked={settings.continuation?.enabled ?? false}
      onChange={e =>
        updateSettings({
          continuation: {
            ...(settings.continuation ?? { targetSessionId: null, mode: 'semi', snapshotIntervalChars: 4000 }),
            enabled: e.target.checked,
          },
        })
      }
    />
  </div>

  {/* Mode selector */}
  <div className={css`margin-bottom: 16px;`}>
    <label className={css`font-size: 13px; color: var(--text-secondary); display: block; margin-bottom: 6px;`}>
      Resume mode
    </label>
    <Select
      value={settings.continuation?.mode ?? 'semi'}
      onChange={v =>
        updateSettings({
          continuation: {
            ...(settings.continuation ?? { enabled: false, targetSessionId: null, snapshotIntervalChars: 4000 }),
            mode: v as 'auto' | 'semi' | 'file-only',
          },
        })
      }
      options={[
        { value: 'auto',      label: 'Auto — inject immediately into target session' },
        { value: 'semi',      label: 'Semi-automatic — show modal to confirm injection' },
        { value: 'file-only', label: 'File only — save checkpoint, no injection' },
      ]}
    />
  </div>

  {/* Snapshot interval */}
  <div className={css`margin-bottom: 16px;`}>
    <label className={css`font-size: 13px; color: var(--text-secondary); display: block; margin-bottom: 6px;`}>
      Periodic snapshot interval (chars)
    </label>
    <Input
      type="number"
      value={String(settings.continuation?.snapshotIntervalChars ?? 4000)}
      onChange={e => {
        const v = parseInt(e.target.value, 10);
        if (!isNaN(v) && v >= 500) {
          updateSettings({
            continuation: {
              ...(settings.continuation ?? { enabled: false, targetSessionId: null, mode: 'semi' }),
              snapshotIntervalChars: v,
            },
          });
        }
      }}
    />
    <div className={css`font-size: 11px; color: var(--text-tertiary); margin-top: 4px;`}>
      A progress snapshot is written every N new buffer characters. Minimum: 500.
    </div>
  </div>
</div>
```

- [ ] **Step 3: Build to verify TypeScript compiles**

```bash
bun run tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(continuation): add session continuation settings section"
```

---

## Task 10: Continuation Modal (Session Picker + Injection)

**Files:**
- Create: `src/components/ui/ContinuationModal.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Create the modal component**

```tsx
// src/components/ui/ContinuationModal.tsx
import React, { useState } from 'react';
import { css } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import { Save, X } from 'lucide-react';
import { writePtyChunked } from '../../utils/ptyUtils';
import type { CheckpointSnapshot } from '../../types';
import type { TerminalSession } from '../../types';

interface ContinuationModalProps {
  snapshot: CheckpointSnapshot;
  sessions: TerminalSession[];
  targetSessionId: string | null;
  onDismiss: () => void;
}

const RESUME_PREFIX =
  'Continue working on the following task. A previous agent session stopped mid-way. ' +
  'Here is the full context of what happened and what needs to happen next:\n\n';

export const ContinuationModal: React.FC<ContinuationModalProps> = ({
  snapshot,
  sessions,
  targetSessionId,
  onDismiss,
}) => {
  const [selectedId, setSelectedId] = useState<string>(
    targetSessionId ?? sessions[0]?.id ?? ''
  );
  const [injecting, setInjecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInject = async () => {
    if (!selectedId) return;
    setInjecting(true);
    setError(null);
    try {
      // Read the resume section from the checkpoint file path
      // We embed the file path in the snapshot; for injection we read it back.
      // Since file read isn't exposed here, we use the filePath as display only
      // and inject a reference message. The full checkpoint path is in snapshot.filePath.
      const message = `${RESUME_PREFIX}Checkpoint file: ${snapshot.filePath}\n\n` +
        `Please read the checkpoint file and continue from where the previous session stopped.`;
      await writePtyChunked(selectedId, message + '\r');
      onDismiss();
    } catch (err) {
      setError(String(err));
    } finally {
      setInjecting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={css`
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000;
        `}
        onClick={onDismiss}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className={css`
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 24px;
            width: 420px;
            max-width: 90vw;
          `}
          onClick={e => e.stopPropagation()}
        >
          <div className={css`display: flex; align-items: center; gap: 10px; margin-bottom: 16px;`}>
            <Save size={18} color="var(--color-success)" />
            <span className={css`font-size: 15px; font-weight: 600; color: var(--text-primary);`}>
              Agent stopped — checkpoint saved
            </span>
            <button
              onClick={onDismiss}
              className={css`
                margin-left: auto;
                background: none; border: none; cursor: pointer;
                color: var(--text-tertiary);
                &:hover { color: var(--text-primary); }
              `}
            >
              <X size={16} />
            </button>
          </div>

          <div className={css`font-size: 12px; color: var(--text-tertiary); margin-bottom: 16px; word-break: break-all;`}>
            {snapshot.sessionTitle} · {snapshot.label} · {snapshot.filePath.split('/').slice(-1)[0]}
          </div>

          <label className={css`font-size: 13px; color: var(--text-secondary); display: block; margin-bottom: 8px;`}>
            Inject resume prompt into:
          </label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className={css`
              width: 100%;
              background: var(--bg-primary);
              border: 1px solid var(--border-color);
              border-radius: 6px;
              padding: 8px 10px;
              color: var(--text-primary);
              font-size: 13px;
              margin-bottom: 16px;
              outline: none;
              &:focus { border-color: var(--color-brand); }
            `}
          >
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>

          {error && (
            <div className={css`font-size: 12px; color: var(--color-danger); margin-bottom: 12px;`}>
              {error}
            </div>
          )}

          <div className={css`display: flex; gap: 8px; justify-content: flex-end;`}>
            <button
              onClick={onDismiss}
              className={css`
                padding: 8px 14px; border-radius: 6px; font-size: 13px;
                background: var(--bg-primary); border: 1px solid var(--border-color);
                color: var(--text-secondary); cursor: pointer;
                &:hover { color: var(--text-primary); }
              `}
            >
              Save File Only
            </button>
            <button
              onClick={handleInject}
              disabled={!selectedId || injecting}
              className={css`
                padding: 8px 14px; border-radius: 6px; font-size: 13px;
                background: var(--color-brand); border: none;
                color: white; cursor: pointer; font-weight: 500;
                &:disabled { opacity: 0.5; cursor: not-allowed; }
                &:hover:not(:disabled) { opacity: 0.9; }
              `}
            >
              {injecting ? 'Injecting…' : 'Inject & Resume'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
```

- [ ] **Step 2: Export from UI barrel**

In `src/components/ui/index.ts`, add:

```typescript
export { ContinuationModal } from './ContinuationModal';
```

- [ ] **Step 3: Build to verify TypeScript compiles**

```bash
bun run tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/ContinuationModal.tsx src/components/ui/index.ts
git commit -m "feat(continuation): add ContinuationModal session-picker component"
```

---

## Task 11: Mount Modal in App Layout

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Read AppLayout to find the right mounting spot**

Open `src/components/layout/AppLayout.tsx`. Look for where `Toast` or other modal components are rendered — the new modal mounts alongside them.

- [ ] **Step 2: Add continuation modal rendering**

Add import at the top:

```typescript
import { ContinuationModal } from '../ui/ContinuationModal';
import { useDashboard } from '../../context/DashboardContext';
```

Inside the `AppLayout` component, destructure from context:

```typescript
const {
  pendingInjectionSnapshot,
  setPendingInjectionSnapshot,
  terminalSessions,
  settings,
} = useDashboard();
```

In the JSX (alongside other overlay components like `<Toast>`), add:

```tsx
{pendingInjectionSnapshot && (
  <ContinuationModal
    snapshot={pendingInjectionSnapshot}
    sessions={terminalSessions}
    targetSessionId={settings.continuation?.targetSessionId ?? null}
    onDismiss={() => setPendingInjectionSnapshot(null)}
  />
)}
```

- [ ] **Step 3: Handle auto mode — inject without modal**

First, add a static import at the top of `DashboardContext.tsx` (alongside the other service imports):

```typescript
import { writePtyChunked } from '../utils/ptyUtils';
```

Then in the `useEffect` added in Task 7, replace the `auto` branch logic:

Find:
```typescript
// semi or auto — surface for injection
setPendingInjectionSnapshot(event.snapshot);
```

Replace with:
```typescript
const mode = continuationCfg.mode;
const targetId = continuationCfg.targetSessionId;

if (mode === 'auto' && targetId) {
  const message =
    'Continue working on the following task. A previous agent session stopped mid-way. ' +
    `Here is the full context of what happened and what needs to happen next:\n\n` +
    `Checkpoint file: ${event.snapshot!.filePath}\n\n` +
    `Please read the checkpoint file and continue from where the previous session stopped.`;
  writePtyChunked(targetId, message + '\r').catch(() => {});
  showToast(`Auto-resumed ${event.snapshot!.sessionTitle} in target session`, 'success');
} else {
  setPendingInjectionSnapshot(event.snapshot);
}
```

- [ ] **Step 4: Build to verify TypeScript compiles**

```bash
bun run tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppLayout.tsx src/context/DashboardContext.tsx
git commit -m "feat(continuation): mount ContinuationModal and wire auto-injection"
```

---

## Task 12: Run Full Test Suite

- [ ] **Step 1: Run all tests**

```bash
bun run test
```

Expected: All existing tests PASS + new tests PASS. No regressions.

- [ ] **Step 2: Fix any TypeScript issues**

```bash
bun run tsc --noEmit
```

Fix any remaining type errors before proceeding.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(continuation): complete session continuation system"
```

---

## Post-Implementation Manual Test

Start the app (`bun run tauri dev`). Open a terminal tab with any agent running. Go to Settings → Session Continuation → enable it. Run a task in the terminal. Verify:

1. No errors in console during normal operation
2. Periodic snapshot files appear in `{workspace}/.orchaterm/checkpoints/`  
3. When an agent finishes/exits, a toast appears
4. Clicking "Resume" shows the session-picker modal
5. Clicking "Inject & Resume" writes the resume prompt to the selected terminal tab
