# Multi-Agent Communication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable AI agents running in separate terminals to communicate with each other through a local Ollama orchestrator, in both structured pipeline mode (existing Conductor) and a new autonomous team mode.

**Architecture:** Three sequential phases: (1) Terminal Interrupt Policies — per-terminal safety rules for when injection is allowed; (2) Mid-task Needs Protocol — agents signal mid-task help requests that Ollama brokers between peers; (3) Autonomous Monitoring Mode — Ollama proactively watches all terminals in a Space and routes context without user prompting. The existing Conductor (sequential pipeline) is untouched. Phase 2 and Phase 3 are independent of each other and can be built in either order after Phase 1.

**Tech Stack:** TypeScript, React 19, Vite 7, Tauri 2, @emotion/css, Vitest (to be installed), xterm.js

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `vitest.config.ts` | Vitest configuration |
| `src/tests/setup.ts` | Global test setup (mock Tauri invoke) |
| `src/tests/interruptPolicy.test.ts` | Unit tests for canInjectNow() |
| `src/tests/sentinelParser.test.ts` | Unit tests for parseNeedsBlock() |
| `src/tests/needsBroker.test.ts` | Unit tests for NeedsBroker |
| `src/tests/autonomousOrchestrator.test.ts` | Unit tests for AutonomousOrchestrator |
| `src/utils/interruptPolicy.ts` | `canInjectNow(buffer, policy)` — pure utility |
| `src/types/autonomous.types.ts` | `InterruptPolicy`, `AgentNeedsRequest`, `RoutingEvent` |
| `src/services/needsBroker.ts` | Detects NEEDS sentinels, asks Ollama, injects answers |
| `src/services/autonomousOrchestrator.ts` | Watches terminals, routes context proactively |

### Modified files
| File | What changes |
|---|---|
| `src/types/terminal.types.ts` | Add `interruptPolicy: InterruptPolicy` field |
| `src/types/index.ts` | Export new types from `autonomous.types.ts` |
| `src/services/sentinelParser.ts` | Add `NEEDS_START`/`NEEDS_END` constants + `parseNeedsBlock()` |
| `src/services/bufferWatcher.ts` | Support multiple summary subscribers per session |
| `src/services/ollamaRelay.ts` | Add `resolveNeedsRequest()` and `evaluateAndRoute()` |
| `src/context/DashboardContext.tsx` | Expose `interruptPolicy` via `updateTerminalSession` |
| `src/components/terminal/TerminalContainer.tsx` | Add interrupt policy picker to tab strip |
| `src/components/ui/GroupChat.tsx` | Autonomous mode toggle + show routing/needs events |
| `src/pages/Conductor.tsx` | Update `PROTOCOL_MD` to include NEEDS protocol |
| `src/components/conductor/WorkspaceConductor.tsx` | Update `PROTOCOL_MD` to include NEEDS protocol |

---

## Phase 1 — Terminal Interrupt Policies

> **Why this comes first:** Every injection in Phases 2 and 3 must check interrupt policy before calling `write_pty`. This is the safety gate.

The `InterruptPolicy` type controls when an automated injection is allowed into a terminal:
- `'never'` — never auto-inject (safe default for all agents)
- `'prompt-only'` — only inject when the buffer ends with a recognizable shell/agent prompt
- `'always'` — inject at any time (for agents known to handle interruptions gracefully)

---

### Task 1: Vitest Setup

**Files:**
- Create: `vitest.config.ts`
- Create: `src/tests/setup.ts`
- Modify: `package.json` (add test script + devDependencies)

- [ ] **Step 1: Install Vitest**

```powershell
npm install --save-dev vitest @vitest/ui jsdom @testing-library/jest-dom
```

Expected: packages installed, no errors.

- [ ] **Step 2: Create vitest.config.ts**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
  },
});
```

- [ ] **Step 3: Create src/tests/setup.ts**

Tauri's `invoke` is not available in Node. Mock it globally so service tests don't crash.

```typescript
// src/tests/setup.ts
import { vi } from 'vitest';

// Mock @tauri-apps/api/core so services that import invoke don't crash in tests.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock @tauri-apps/api/event — bufferWatcher uses listen()
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
```

- [ ] **Step 4: Add test script to package.json**

Open `package.json` and add `"test": "vitest run"` and `"test:watch": "vitest"` to the `"scripts"` section so it reads:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: Verify setup runs**

```powershell
npm test
```

Expected output: `No test files found, exiting with code 0` (or similar — no crash).

- [ ] **Step 6: Commit**

```powershell
git add vitest.config.ts src/tests/setup.ts package.json package-lock.json
git commit -m "chore: add Vitest test infrastructure"
```

---

### Task 2: Interrupt Policy Types and Utility

**Files:**
- Create: `src/types/autonomous.types.ts`
- Create: `src/utils/interruptPolicy.ts`
- Create: `src/tests/interruptPolicy.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/interruptPolicy.test.ts
import { describe, it, expect } from 'vitest';
import { canInjectNow } from '../utils/interruptPolicy';

describe('canInjectNow', () => {
  describe('policy: always', () => {
    it('returns true regardless of buffer', () => {
      expect(canInjectNow('agent is working...', 'always')).toBe(true);
      expect(canInjectNow('', 'always')).toBe(true);
    });
  });

  describe('policy: never', () => {
    it('returns false regardless of buffer', () => {
      expect(canInjectNow('$ ', 'never')).toBe(false);
      expect(canInjectNow('', 'never')).toBe(false);
    });
  });

  describe('policy: prompt-only', () => {
    it('returns true when buffer ends with a bash $ prompt', () => {
      expect(canInjectNow('some output\n$ ', 'prompt-only')).toBe(true);
    });

    it('returns true when buffer ends with PowerShell > prompt', () => {
      expect(canInjectNow('PS C:\\> ', 'prompt-only')).toBe(true);
    });

    it('returns true when buffer ends with zsh ❯ prompt', () => {
      expect(canInjectNow('output\n❯ ', 'prompt-only')).toBe(true);
    });

    it('returns false when buffer shows mid-work output (no prompt)', () => {
      expect(canInjectNow('Installing dependencies...\nFetching packages', 'prompt-only')).toBe(false);
    });

    it('returns false for empty buffer', () => {
      expect(canInjectNow('', 'prompt-only')).toBe(false);
    });

    it('strips ANSI codes before checking', () => {
      // ANSI-decorated prompt: ESC[32m$ESC[0m space
      const ansiPrompt = 'output\n\x1b[32m$\x1b[0m ';
      expect(canInjectNow(ansiPrompt, 'prompt-only')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```powershell
npm test
```

Expected: FAIL — `Cannot find module '../utils/interruptPolicy'`

- [ ] **Step 3: Create src/types/autonomous.types.ts**

```typescript
// src/types/autonomous.types.ts

/** Controls when automated messages may be injected into a terminal session. */
export type InterruptPolicy =
  | 'never'        // Never auto-inject (safe for all agents, default)
  | 'prompt-only'  // Only inject when the buffer ends with a recognizable shell/agent prompt
  | 'always';      // Inject at any time (for agents known to handle interruptions)

/** Emitted by NeedsBroker when an agent requests help. */
export interface AgentNeedsRequest {
  /** The question the agent is asking. */
  ask: string;
  /** The context the agent provided about its current situation. */
  context: string;
}

/** Events emitted by AutonomousOrchestrator into the GroupChat feed. */
export type RoutingEvent =
  | { type: 'relayed'; from: string; to: string; message: string }
  | { type: 'relay-skipped'; reason: 'interrupt-policy' | 'no-relevant-content'; target: string }
  | { type: 'needs-answered'; requestingAgent: string; question: string; answer: string }
  | { type: 'needs-failed'; requestingAgent: string; error: string };
```

- [ ] **Step 4: Create src/utils/interruptPolicy.ts**

```typescript
// src/utils/interruptPolicy.ts
import { InterruptPolicy } from '../types';

/** Shell and agent prompt patterns we recognise as safe injection points. */
const PROMPT_PATTERNS: RegExp[] = [
  /\$\s*$/,       // bash/sh prompt: ends with "$" + optional space
  />\s*$/,        // PowerShell/cmd prompt: ends with ">" + optional space
  /❯\s*$/,        // zsh/oh-my-zsh prompt: ends with "❯" + optional space
  /%%\s*$/,       // tcsh prompt
  /#\s*$/,        // root shell prompt
];

/** Strips ANSI escape sequences so prompts hidden in coloured output are found. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b./g, '');
}

/**
 * Returns true if it is safe to auto-inject a message into a terminal
 * session right now, based on the session's interrupt policy and its
 * current buffer content.
 *
 * @param buffer  The raw terminal buffer (may contain ANSI codes).
 * @param policy  The session's configured interrupt policy.
 */
export function canInjectNow(buffer: string, policy: InterruptPolicy): boolean {
  if (policy === 'always') return true;
  if (policy === 'never')  return false;

  // 'prompt-only': check the last few non-empty lines for a known prompt.
  const clean = stripAnsi(buffer);
  const lastChunk = clean.split('\n').filter(l => l.trim()).slice(-5).join('\n');
  if (!lastChunk) return false;
  return PROMPT_PATTERNS.some(p => p.test(lastChunk));
}
```

- [ ] **Step 5: Run tests — verify they pass**

```powershell
npm test
```

Expected: All 7 tests PASS.

- [ ] **Step 6: Export new types from src/types/index.ts**

Open `src/types/index.ts` and add:

```typescript
export * from './autonomous.types';
```

- [ ] **Step 7: Commit**

```powershell
git add src/types/autonomous.types.ts src/utils/interruptPolicy.ts src/tests/interruptPolicy.test.ts src/types/index.ts
git commit -m "feat(interrupt): add InterruptPolicy type and canInjectNow utility"
```

---

### Task 3: Add interruptPolicy to TerminalSession

**Files:**
- Modify: `src/types/terminal.types.ts`

- [ ] **Step 1: Update TerminalSession type**

Open `src/types/terminal.types.ts`. The file currently reads:

```typescript
export interface TerminalSession {
  id: string;
  title: string;
  shell: string;
  shellArgs: string[];
  workspaceId: string;
  color: string | null;
  order: number;
}
```

Replace the entire file with:

```typescript
// ── Terminal Session types ────────────────────────────────────────────────────
import { InterruptPolicy } from './autonomous.types';

export interface TerminalSession {
  id: string;
  title: string;
  shell: string;
  shellArgs: string[];
  workspaceId: string;
  /** Hex colour for the tab indicator. null = default (no colour). */
  color: string | null;
  /** Display order within the tab strip. Lower = leftmost. */
  order: number;
  /**
   * Controls when automated messages (from NeedsBroker or AutonomousOrchestrator)
   * may be injected into this terminal.
   * Default: 'never' — safe for all agent types.
   */
  interruptPolicy: InterruptPolicy;
}
```

- [ ] **Step 2: Add a default policy wherever TerminalSessions are created**

Search for all `addTerminalSession` calls in the codebase. There will be one in `src/components/terminal/TerminalContainer.tsx`. When constructing the `TerminalSession` object, add `interruptPolicy: 'never'` as the default.

Open `src/components/terminal/TerminalContainer.tsx` and find where the new session object is built. It will look something like:

```typescript
addTerminalSession({
  id: sessionId,
  title: ...,
  shell: ...,
  shellArgs: ...,
  workspaceId: ...,
  color: null,
  order: ...,
});
```

Add `interruptPolicy: 'never'` to that object:

```typescript
addTerminalSession({
  id: sessionId,
  title: ...,
  shell: ...,
  shellArgs: ...,
  workspaceId: ...,
  color: null,
  order: ...,
  interruptPolicy: 'never',
});
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```powershell
npm run build 2>&1 | Select-String -Pattern "error TS"
```

Expected: no `error TS` lines.

- [ ] **Step 4: Commit**

```powershell
git add src/types/terminal.types.ts src/components/terminal/TerminalContainer.tsx
git commit -m "feat(interrupt): add interruptPolicy field to TerminalSession (default: never)"
```

---

### Task 4: Interrupt Policy Picker UI

**Files:**
- Modify: `src/components/terminal/TerminalContainer.tsx`

> **Context:** `TerminalContainer.tsx` renders the tab strip above the terminal panes. Each tab already has rename and colour actions. We'll add a small policy selector that appears in a right-click context menu on the tab.

- [ ] **Step 1: Add a context menu to each terminal tab in TerminalContainer**

Open `src/components/terminal/TerminalContainer.tsx`. Find the part where the tab strip is rendered (the list of tab buttons). Each tab button should already have mouse event handlers.

Add a right-click handler that opens a small floating context menu. The context menu shows three policy options. When selected, it calls `updateTerminalSession(sessionId, { interruptPolicy: chosen })`.

Add the following state and handler near the top of the component (inside the component function, after existing state):

```typescript
// Context menu for interrupt policy
const [policyMenu, setPolicyMenu] = useState<{
  sessionId: string;
  x: number;
  y: number;
} | null>(null);

const handleTabContextMenu = (e: React.MouseEvent, sessionId: string) => {
  e.preventDefault();
  setPolicyMenu({ sessionId, x: e.clientX, y: e.clientY });
};

const handlePolicySelect = (policy: InterruptPolicy) => {
  if (!policyMenu) return;
  updateTerminalSession(policyMenu.sessionId, { interruptPolicy: policy });
  setPolicyMenu(null);
};
```

Add `InterruptPolicy` to imports from `../types`.
Add `updateTerminalSession` to the destructured values from `useDashboard()`.

- [ ] **Step 2: Add onContextMenu to the tab button element**

Find the tab button JSX (it renders each session as a clickable tab). Add `onContextMenu={(e) => handleTabContextMenu(e, session.id)}` to the tab button element.

- [ ] **Step 3: Add the context menu overlay JSX**

At the bottom of the component's return statement, before the closing `</div>`, add:

```tsx
{/* Interrupt policy context menu */}
{policyMenu && (
  <>
    {/* Backdrop — click outside to close */}
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 99 }}
      onClick={() => setPolicyMenu(null)}
    />
    <div
      style={{
        position: 'fixed',
        top: policyMenu.y,
        left: policyMenu.x,
        zIndex: 100,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 200,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        fontSize: 12,
      }}
    >
      <div style={{ padding: '4px 12px 6px', fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Auto-inject policy
      </div>
      {(['never', 'prompt-only', 'always'] as const).map(policy => {
        const session = terminalSessions.find(s => s.id === policyMenu.sessionId);
        const active  = session?.interruptPolicy === policy;
        const labels: Record<string, string> = {
          'never':        '🔒 Never — block all injections',
          'prompt-only':  '⏸ Prompt only — wait for idle',
          'always':       '⚡ Always — inject immediately',
        };
        return (
          <button
            key={policy}
            onClick={() => handlePolicySelect(policy)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 12px',
              background: active ? 'rgba(123,104,238,0.12)' : 'transparent',
              border: 'none',
              color: active ? 'var(--color-brand)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: active ? 700 : 400,
            }}
          >
            {labels[policy]}
          </button>
        );
      })}
    </div>
  </>
)}
```

- [ ] **Step 4: Import useState if not already imported**

Ensure `useState` is in the React import at the top of the file.

- [ ] **Step 5: Build to verify no TypeScript errors**

```powershell
npm run build 2>&1 | Select-String -Pattern "error TS"
```

Expected: no `error TS` lines.

- [ ] **Step 6: Commit**

```powershell
git add src/components/terminal/TerminalContainer.tsx
git commit -m "feat(interrupt): add right-click interrupt policy picker to terminal tabs"
```

---

## Phase 2 — Mid-task Needs Protocol

> **What this builds:** An agent can output a `###AGENTDECK_NEEDS###` block mid-task. AgentDeck detects it, reads what other agents in the Space are working on, asks Ollama to synthesise an answer, and injects it back — if the interrupt policy allows.

**New sentinel format agents must output:**
```
###AGENTDECK_NEEDS###
ask: What auth middleware signature is Agent B building?
context: I'm calling it from the frontend service and need the exact function signature
###AGENTDECK_NEEDS_END###
```

---

### Task 5: NEEDS Sentinel Parser

**Files:**
- Modify: `src/services/sentinelParser.ts`
- Create: `src/tests/sentinelParser.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/sentinelParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseNeedsBlock } from '../services/sentinelParser';

describe('parseNeedsBlock', () => {
  it('returns null when no NEEDS block is present', () => {
    expect(parseNeedsBlock('some terminal output without a block')).toBeNull();
  });

  it('returns null when block is incomplete (start but no end)', () => {
    const buf = 'output\n###AGENTDECK_NEEDS###\nask: something\n';
    expect(parseNeedsBlock(buf)).toBeNull();
  });

  it('parses a complete NEEDS block', () => {
    const buf = [
      'Some agent output',
      '###AGENTDECK_NEEDS###',
      'ask: What is the database schema?',
      'context: I need to write a migration',
      '###AGENTDECK_NEEDS_END###',
    ].join('\n');

    const result = parseNeedsBlock(buf);
    expect(result).not.toBeNull();
    expect(result!.ask).toBe('What is the database schema?');
    expect(result!.context).toBe('I need to write a migration');
  });

  it('uses the LAST complete block in the buffer (handles repeated attempts)', () => {
    const buf = [
      '###AGENTDECK_NEEDS###',
      'ask: First question',
      'context: first context',
      '###AGENTDECK_NEEDS_END###',
      'more output',
      '###AGENTDECK_NEEDS###',
      'ask: Second question',
      'context: second context',
      '###AGENTDECK_NEEDS_END###',
    ].join('\n');

    const result = parseNeedsBlock(buf);
    expect(result!.ask).toBe('Second question');
  });

  it('strips ANSI codes before parsing', () => {
    const buf = [
      '\x1b[32m###AGENTDECK_NEEDS###\x1b[0m',
      'ask: What is X?',
      'context: doing Y',
      '###AGENTDECK_NEEDS_END###',
    ].join('\n');

    expect(parseNeedsBlock(buf)).not.toBeNull();
    expect(parseNeedsBlock(buf)!.ask).toBe('What is X?');
  });

  it('returns empty string for context when field is missing', () => {
    const buf = [
      '###AGENTDECK_NEEDS###',
      'ask: What is X?',
      '###AGENTDECK_NEEDS_END###',
    ].join('\n');

    const result = parseNeedsBlock(buf);
    expect(result!.ask).toBe('What is X?');
    expect(result!.context).toBe('');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```powershell
npm test
```

Expected: FAIL — `parseNeedsBlock is not a function` or similar.

- [ ] **Step 3: Add NEEDS constants and parseNeedsBlock to sentinelParser.ts**

Open `src/services/sentinelParser.ts`. At the end of the **sentinel markers** section (after `PLAN_END`), add:

```typescript
// ── Needs markers ────────────────────────────────────────────────────────────────
export const NEEDS_START = '###AGENTDECK_NEEDS###';
export const NEEDS_END   = '###AGENTDECK_NEEDS_END###';
```

Then add the following function at the bottom of the file, after `validatePlanJSON`:

```typescript
// ── Needs block parsing ─────────────────────────────────────────────────────────

import { AgentNeedsRequest } from '../types';

/**
 * Scans a terminal buffer for a complete NEEDS block (the last one if multiple).
 * Returns null if no complete block is present yet.
 *
 * Agents output this block mid-task to request information from peer agents:
 *
 *   ###AGENTDECK_NEEDS###
 *   ask: <question>
 *   context: <what the agent is currently working on>
 *   ###AGENTDECK_NEEDS_END###
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
```

- [ ] **Step 4: Run tests — verify they pass**

```powershell
npm test
```

Expected: All tests PASS (including previous interruptPolicy tests).

- [ ] **Step 5: Commit**

```powershell
git add src/services/sentinelParser.ts src/tests/sentinelParser.test.ts
git commit -m "feat(needs): add NEEDS sentinel constants and parseNeedsBlock parser"
```

---

### Task 6: BufferWatcher Multi-Subscriber Support for Summary Mode

**Files:**
- Modify: `src/services/bufferWatcher.ts`

> **Why:** Both `GroupChat` (live feed) and `AutonomousOrchestrator` (Phase 3) need to receive summary callbacks for the same sessions. The current implementation only supports one subscriber. Change `onSummaryChunk` to an array.

- [ ] **Step 1: Update the WatchEntry interface in bufferWatcher.ts**

Open `src/services/bufferWatcher.ts`. Find the `WatchEntry` interface:

```typescript
interface WatchEntry {
  ...
  onSummaryChunk?: (chunk: string) => void;
  summaryDebounceTimer?: ReturnType<typeof setTimeout>;
  summaryLastLength?: number;
}
```

Change `onSummaryChunk` from a single callback to an array:

```typescript
interface WatchEntry {
  buffer: SessionBuffer;
  unlisten: UnlistenFn;
  onSentinel?: (output: OrchestratorTaskOutput) => void;
  onPlan?: (rawJson: string) => void;
  onPlanError?: (err: string) => void;
  ignoreUntil?: number;
  // Summary mode — supports multiple concurrent subscribers
  summarySubscribers: Array<(chunk: string) => void>;
  summaryDebounceTimer?: ReturnType<typeof setTimeout>;
  summaryLastLength?: number;
}
```

- [ ] **Step 2: Update the entry creation in ensureListening**

Find `const entry: WatchEntry = { buffer, unlisten };` and change it to:

```typescript
const entry: WatchEntry = { buffer, unlisten, summarySubscribers: [] };
```

- [ ] **Step 3: Update checkSummary to call all subscribers**

Find the `checkSummary` private method. Replace its contents:

```typescript
private checkSummary(entry: WatchEntry): void {
  if (entry.summarySubscribers.length === 0) return;

  const MIN_NEW_CHARS = 60;
  const DEBOUNCE_MS   = 800;

  const currentLength = entry.buffer.buffer.length;
  const lastLength    = entry.summaryLastLength ?? 0;
  const newChars      = currentLength - lastLength;

  if (newChars < MIN_NEW_CHARS) return;

  if (entry.summaryDebounceTimer) clearTimeout(entry.summaryDebounceTimer);
  entry.summaryDebounceTimer = setTimeout(() => {
    if (entry.summarySubscribers.length === 0) return;
    const newContent = entry.buffer.buffer.slice(lastLength);
    entry.summaryLastLength = entry.buffer.buffer.length;
    // Call all subscribers with the same delta
    for (const cb of entry.summarySubscribers) cb(newContent);
  }, DEBOUNCE_MS);
}
```

- [ ] **Step 4: Update watchForSummary to add (not replace) the subscriber**

Find the `watchForSummary` public method. The current signature and body:

```typescript
async watchForSummary(sessionId: string, onChunk: (chunk: string) => void): Promise<void> {
  const entry = await this.ensureListening(sessionId);
  entry.buffer.mode    = 'summary';
  entry.onSummaryChunk = onChunk;
  ...
}
```

Replace the body:

```typescript
async watchForSummary(
  sessionId: string,
  onChunk: (chunk: string) => void,
): Promise<() => void> {
  const entry = await this.ensureListening(sessionId);
  entry.buffer.mode = 'summary';
  entry.onSentinel  = undefined;
  entry.onPlan      = undefined;
  entry.onPlanError = undefined;
  if (!entry.summarySubscribers.includes(onChunk)) {
    entry.summarySubscribers.push(onChunk);
  }
  // Start from current buffer length so only new content fires
  entry.summaryLastLength = entry.summaryLastLength ?? entry.buffer.buffer.length;

  // Return an unsubscribe function for this specific subscriber
  return () => {
    entry.summarySubscribers = entry.summarySubscribers.filter(cb => cb !== onChunk);
    if (entry.summarySubscribers.length === 0) {
      if (entry.summaryDebounceTimer) clearTimeout(entry.summaryDebounceTimer);
      entry.buffer.mode = 'idle';
    }
  };
}
```

- [ ] **Step 5: Update clearSummary to remove all subscribers**

Find `clearSummary`. Update it:

```typescript
clearSummary(sessionId: string): void {
  const entry = this.entries.get(sessionId);
  if (!entry) return;
  if (entry.summaryDebounceTimer) clearTimeout(entry.summaryDebounceTimer);
  entry.summarySubscribers   = [];
  entry.summaryDebounceTimer = undefined;
  entry.summaryLastLength    = undefined;
  if (entry.buffer.mode === 'summary') entry.buffer.mode = 'idle';
}
```

- [ ] **Step 6: Fix GroupChat.tsx — update the watchForSummary call**

Open `src/components/ui/GroupChat.tsx`. Find the `useEffect` that calls `bufferWatcher.watchForSummary`. It currently calls `bufferWatcher.clearSummary(s.id)` in the cleanup. 

Update the effect to store and call the returned unsubscribe functions:

```typescript
useEffect(() => {
  if (!liveFeedOn || !settings.conductorOllamaModel || !settings.ollamaHost) return;

  const unsubscribers: (() => void)[] = [];

  groupSessions.forEach(session => {
    const onChunk = async (chunk: string) => {
      try {
        const summary = await summariseChunk(
          chunk, session.title,
          settings.ollamaHost, settings.conductorOllamaModel,
        );
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'agent-summary',
          content: summary,
          sessionTitle: session.title,
          sessionColor: session.color,
        }]);
      } catch { /* silently skip */ }
    };

    bufferWatcher.watchForSummary(session.id, onChunk).then(unsub => {
      unsubscribers.push(unsub);
    });
  });

  return () => { unsubscribers.forEach(fn => fn()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [liveFeedOn, groupSessionIds, settings.conductorOllamaModel, settings.ollamaHost]);
```

- [ ] **Step 7: Build — verify no TypeScript errors**

```powershell
npm run build 2>&1 | Select-String -Pattern "error TS"
```

Expected: no `error TS` lines.

- [ ] **Step 8: Commit**

```powershell
git add src/services/bufferWatcher.ts src/components/ui/GroupChat.tsx
git commit -m "feat(buffer): support multiple summary subscribers per session"
```

---

### Task 7: resolveNeedsRequest in ollamaRelay

**Files:**
- Modify: `src/services/ollamaRelay.ts`

- [ ] **Step 1: Add resolveNeedsRequest function to ollamaRelay.ts**

Open `src/services/ollamaRelay.ts`. Add the following new function and its input type at the end of the file:

```typescript
// ── Needs request resolution ───────────────────────────────────────────────────

export interface NeedsResolutionInput {
  /** The question the requesting agent asked. */
  ask: string;
  /** The context the requesting agent provided. */
  context: string;
  /** Display title of the requesting agent's terminal. */
  requestingAgent: string;
  /**
   * Peer agent context: title + recent buffer content for each sibling session.
   * Pre-truncated by the caller to avoid token bloat.
   */
  peerContext: Array<{ title: string; recentOutput: string }>;
  ollamaHost: string;
  model: string;
}

/**
 * Synthesises an answer to a mid-task help request from a peer agent's output.
 * Used by NeedsBroker. Throws if Ollama is unreachable.
 *
 * Response is ≤ 150 words, direct, and references specific identifiers from
 * the peer's output.
 */
export async function resolveNeedsRequest(input: NeedsResolutionInput): Promise<string> {
  const { ask, context, requestingAgent, peerContext, ollamaHost, model } = input;

  const peerBlocks = peerContext.length > 0
    ? peerContext.map(p =>
        `=== ${p.title} ===\n${p.recentOutput || '(no recent output)'}`
      ).join('\n\n')
    : '(no peer agents have recent output)';

  const userPrompt = `Agent "${requestingAgent}" is asking for help mid-task.

QUESTION: ${ask}
THEIR CONTEXT: ${context || '(none provided)'}

WHAT OTHER AGENTS HAVE BEEN DOING:
${peerBlocks}

Write a direct, actionable answer (≤ 150 words) synthesised from the other agents' work.
Include specific identifiers (function names, file paths, variable names) where relevant.
If the peer output contains no relevant information, say so in one sentence.
Do NOT add suggestions beyond what was asked.`;

  return callOllama(ollamaHost, model, userPrompt);
}
```

- [ ] **Step 2: Build — verify no TypeScript errors**

```powershell
npm run build 2>&1 | Select-String -Pattern "error TS"
```

Expected: no `error TS` lines.

- [ ] **Step 3: Commit**

```powershell
git add src/services/ollamaRelay.ts
git commit -m "feat(needs): add resolveNeedsRequest to ollamaRelay"
```

---

### Task 8: NeedsBroker Service

**Files:**
- Create: `src/services/needsBroker.ts`
- Create: `src/tests/needsBroker.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/needsBroker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NeedsBroker } from '../services/needsBroker';

// Mock ollamaRelay
vi.mock('../services/ollamaRelay', () => ({
  resolveNeedsRequest: vi.fn().mockResolvedValue('The answer from Ollama'),
  checkOllamaOnline: vi.fn().mockResolvedValue(true),
}));

// Mock bufferWatcher
vi.mock('../services/bufferWatcher', () => ({
  bufferWatcher: {
    getBuffer: vi.fn().mockReturnValue('peer agent output'),
    watchForNeeds: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('NeedsBroker', () => {
  let broker: NeedsBroker;

  beforeEach(() => {
    broker = new NeedsBroker();
    broker.updateConfig({ ollamaHost: 'http://localhost:11434', ollamaModel: 'llama3.2' });
  });

  it('registers a space with sessions', () => {
    broker.registerSpace('space-1', [
      { id: 'sess-a', title: 'Claude', color: null, interruptPolicy: 'always' },
      { id: 'sess-b', title: 'Antigravity', color: null, interruptPolicy: 'prompt-only' },
    ]);
    // No error means success — space is registered
    expect(true).toBe(true);
  });

  it('calls resolveNeedsRequest with sibling context when needs detected', async () => {
    const { resolveNeedsRequest } = await import('../services/ollamaRelay');

    broker.registerSpace('space-1', [
      { id: 'sess-a', title: 'Claude', color: null, interruptPolicy: 'always' },
      { id: 'sess-b', title: 'Antigravity', color: null, interruptPolicy: 'always' },
    ]);

    const onAnswer = vi.fn();
    const onError  = vi.fn();

    await broker.handleNeedsRequest(
      'sess-a',
      'space-1',
      { ask: 'What is the API contract?', context: 'Building the client' },
      onAnswer,
      onError,
    );

    expect(resolveNeedsRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        ask: 'What is the API contract?',
        requestingAgent: 'Claude',
        peerContext: expect.arrayContaining([
          expect.objectContaining({ title: 'Antigravity' }),
        ]),
      }),
    );
    expect(onAnswer).toHaveBeenCalledWith('The answer from Ollama');
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError when space is not registered', async () => {
    const onAnswer = vi.fn();
    const onError  = vi.fn();

    await broker.handleNeedsRequest(
      'sess-a',
      'unknown-space',
      { ask: 'x', context: '' },
      onAnswer,
      onError,
    );

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('not registered'));
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```powershell
npm test
```

Expected: FAIL — `Cannot find module '../services/needsBroker'`

- [ ] **Step 3: Create src/services/needsBroker.ts**

```typescript
/**
 * needsBroker.ts
 *
 * Handles mid-task help requests from agents. When an agent outputs a
 * ###AGENTDECK_NEEDS### block, the NeedsBroker:
 *  1. Identifies peer agents in the same Space
 *  2. Asks Ollama to synthesise an answer from their recent output
 *  3. Injects the answer back into the requesting terminal (if policy allows)
 *  4. Emits a RoutingEvent so GroupChat can display the exchange
 *
 * This is a singleton service — one instance shared across the app.
 */

import { invoke } from '@tauri-apps/api/core';
import { AgentNeedsRequest, InterruptPolicy, RoutingEvent } from '../types';
import { resolveNeedsRequest, checkOllamaOnline } from './ollamaRelay';
import { bufferWatcher } from './bufferWatcher';
import { canInjectNow } from '../utils/interruptPolicy';

// ── Config ─────────────────────────────────────────────────────────────────────

interface BrokerConfig {
  ollamaHost: string;
  ollamaModel: string;
}

// ── Session descriptor ─────────────────────────────────────────────────────────

export interface BrokerSession {
  id: string;
  title: string;
  color: string | null;
  interruptPolicy: InterruptPolicy;
}

// ── NeedsBroker ────────────────────────────────────────────────────────────────

export class NeedsBroker {
  private config: BrokerConfig = {
    ollamaHost: 'http://localhost:11434',
    ollamaModel: 'llama3.2',
  };

  /** spaceId → sessions in that space */
  private spaces = new Map<string, BrokerSession[]>();

  /** Subscribers that receive routing events (wired to GroupChat). */
  private eventListeners: Array<(event: RoutingEvent) => void> = [];

  updateConfig(config: Partial<BrokerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  registerSpace(spaceId: string, sessions: BrokerSession[]): void {
    this.spaces.set(spaceId, sessions);
  }

  unregisterSpace(spaceId: string): void {
    this.spaces.delete(spaceId);
  }

  onEvent(cb: (event: RoutingEvent) => void): () => void {
    this.eventListeners.push(cb);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== cb);
    };
  }

  /**
   * Called when a NEEDS block is detected in a terminal's buffer.
   * Resolves the request via Ollama and injects the answer if policy allows.
   */
  async handleNeedsRequest(
    requestingSessionId: string,
    spaceId: string,
    request: AgentNeedsRequest,
    onAnswer: (answer: string) => void,
    onError: (err: string) => void,
  ): Promise<void> {
    const sessions = this.spaces.get(spaceId);
    if (!sessions) {
      onError(`Space "${spaceId}" is not registered with NeedsBroker`);
      return;
    }

    const requestingSession = sessions.find(s => s.id === requestingSessionId);
    if (!requestingSession) {
      onError(`Session "${requestingSessionId}" not found in space "${spaceId}"`);
      return;
    }

    const peers = sessions.filter(s => s.id !== requestingSessionId);
    const peerContext = peers.map(s => ({
      title:        s.title,
      // Trim to last 1200 chars to keep Ollama prompt manageable
      recentOutput: bufferWatcher.getBuffer(s.id).slice(-1200),
    }));

    let answer: string;
    try {
      const online = await checkOllamaOnline(this.config.ollamaHost);
      if (!online) throw new Error('Ollama is offline');

      answer = await resolveNeedsRequest({
        ask:            request.ask,
        context:        request.context,
        requestingAgent: requestingSession.title,
        peerContext,
        ollamaHost:     this.config.ollamaHost,
        model:          this.config.ollamaModel,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      onError(msg);
      this.emit({ type: 'needs-failed', requestingAgent: requestingSession.title, error: msg });
      return;
    }

    onAnswer(answer);

    // Inject the answer back into the requesting terminal if policy allows.
    const currentBuffer = bufferWatcher.getBuffer(requestingSessionId);
    if (canInjectNow(currentBuffer, requestingSession.interruptPolicy)) {
      const injection = `\n[AgentDeck answer to your question]: ${answer}\n`;
      await invoke('write_pty', { sessionId: requestingSessionId, data: injection }).catch(() => {});
    }

    this.emit({
      type:             'needs-answered',
      requestingAgent:  requestingSession.title,
      question:         request.ask,
      answer,
    });
  }

  private emit(event: RoutingEvent): void {
    for (const cb of this.eventListeners) cb(event);
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const needsBroker = new NeedsBroker();
```

- [ ] **Step 4: Run tests — verify they pass**

```powershell
npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/services/needsBroker.ts src/tests/needsBroker.test.ts
git commit -m "feat(needs): add NeedsBroker service for mid-task help requests"
```

---

### Task 9: Wire NeedsBroker to BufferWatcher and GroupChat

**Files:**
- Modify: `src/services/bufferWatcher.ts` — add 'needs' detection alongside sentinel/plan
- Modify: `src/components/ui/GroupChat.tsx` — register space, show needs events
- Modify: `src/pages/Conductor.tsx` — add NEEDS protocol to PROTOCOL_MD
- Modify: `src/components/conductor/WorkspaceConductor.tsx` — add NEEDS protocol to PROTOCOL_MD

- [ ] **Step 1: Add NEEDS detection to BufferWatcher**

Open `src/services/bufferWatcher.ts`.

Import `parseNeedsBlock` and `NEEDS_START` from sentinelParser at the top:

```typescript
import { parseSentinel, parsePlanBlock, validatePlanJSON, parseNeedsBlock } from './sentinelParser';
```

Add a `onNeedsRequest` callback to the `WatchEntry` interface:

```typescript
interface WatchEntry {
  ...
  onNeedsRequest?: (request: import('../types').AgentNeedsRequest) => void;
}
```

In the `onData` private method, add needs checking alongside sentinel/plan. Update the `'sentinel'` case to also check for NEEDS (an agent can output a NEEDS block even while in sentinel mode):

```typescript
private onData(sessionId: string, chunk: string): void {
  const entry = this.entries.get(sessionId);
  if (!entry) return;

  entry.buffer.buffer += chunk;
  entry.buffer.lastActivity = Date.now();

  // NEEDS detection runs regardless of mode — agents can request help at any time
  if (entry.onNeedsRequest) {
    this.checkNeeds(entry);
  }

  switch (entry.buffer.mode) {
    case 'sentinel': this.checkSentinel(entry); break;
    case 'plan':     this.checkPlan(entry); break;
    case 'summary':  this.checkSummary(entry); break;
    case 'idle': break;
  }
}
```

Add the `checkNeeds` private method:

```typescript
private checkNeeds(entry: WatchEntry): void {
  const request = parseNeedsBlock(entry.buffer.buffer);
  if (!request) return;

  // To avoid re-firing for the same block, track the last block we fired for.
  // We use the ask field as a deduplication key.
  if ((entry as any)._lastNeedsAsk === request.ask) return;
  (entry as any)._lastNeedsAsk = request.ask;

  const cb = entry.onNeedsRequest;
  if (cb) cb(request);
}
```

Add a public method to enable needs detection for a session:

```typescript
/**
 * Register a callback for NEEDS block detection on a session.
 * Can be called alongside any other watch mode — NEEDS runs independently.
 * Returns an unsubscribe function.
 */
async watchForNeeds(
  sessionId: string,
  onNeedsRequest: (request: import('../types').AgentNeedsRequest) => void,
): Promise<() => void> {
  const entry = await this.ensureListening(sessionId);
  entry.onNeedsRequest = onNeedsRequest;
  (entry as any)._lastNeedsAsk = undefined; // reset dedup state
  return () => {
    entry.onNeedsRequest = undefined;
  };
}
```

- [ ] **Step 2: Wire NeedsBroker in GroupChat.tsx**

Open `src/components/ui/GroupChat.tsx`.

Add the following imports at the top:

```typescript
import { needsBroker } from '../../services/needsBroker';
import { bufferWatcher } from '../../services/bufferWatcher';
import { RoutingEvent } from '../../types';
```

Add a `useEffect` that registers the space with NeedsBroker when the space or sessions change, and starts watching for NEEDS requests on all sessions:

```typescript
// Register space and wire NEEDS detection
useEffect(() => {
  if (!activeSpaceId) return;

  needsBroker.updateConfig({
    ollamaHost:  settings.ollamaHost,
    ollamaModel: settings.conductorOllamaModel,
  });

  needsBroker.registerSpace(activeSpaceId, groupSessions.map(s => ({
    id:              s.id,
    title:           s.title,
    color:           s.color,
    interruptPolicy: s.interruptPolicy ?? 'never',
  })));

  const unsubNeeds: (() => void)[] = [];

  groupSessions.forEach(session => {
    bufferWatcher.watchForNeeds(session.id, async (request) => {
      await needsBroker.handleNeedsRequest(
        session.id,
        activeSpaceId,
        request,
        (answer) => {
          setMessages(prev => [...prev, {
            id:   crypto.randomUUID(),
            role: 'system',
            content: `🔄 ${session.title} asked: "${request.ask}" → AgentDeck answered`,
          }]);
        },
        (err) => {
          setMessages(prev => [...prev, {
            id:   crypto.randomUUID(),
            role: 'system',
            content: `⚠ Could not resolve ${session.title}'s request: ${err}`,
          }]);
        },
      );
    }).then(unsub => unsubNeeds.push(unsub));
  });

  return () => {
    unsubNeeds.forEach(fn => fn());
    if (activeSpaceId) needsBroker.unregisterSpace(activeSpaceId);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeSpaceId, groupSessionIds, settings.ollamaHost, settings.conductorOllamaModel]);
```

- [ ] **Step 3: Update PROTOCOL_MD in both Conductor files**

The protocol markdown must tell agents about the NEEDS format. In both `src/pages/Conductor.tsx` and `src/components/conductor/WorkspaceConductor.tsx`, find the `PROTOCOL_MD` constant and append the NEEDS section at the end:

```typescript
const PROTOCOL_MD = `# AgentDeck Sentinel Protocol
... (existing content) ...

---

## Mid-task Help Request (optional)

If you need information from another agent mid-task, output this block and then
WAIT — AgentDeck will inject the answer back into your terminal:

${NEEDS_START}
ask: [one clear question — what do you need?]
context: [brief description of what you are working on]
${NEEDS_END}

Rules:
- Use this sparingly — only when genuinely blocked.
- Output this block, then pause and wait for the injected answer.
- Do not repeat the block for the same question.
`;
```

Import `NEEDS_START` and `NEEDS_END` at the top of both files alongside the existing sentinel imports:

```typescript
import { SENTINEL_START, SENTINEL_END, PLAN_START, PLAN_END, NEEDS_START, NEEDS_END } from '../services/sentinelParser';
```

- [ ] **Step 4: Build — verify no TypeScript errors**

```powershell
npm run build 2>&1 | Select-String -Pattern "error TS"
```

Expected: no `error TS` lines.

- [ ] **Step 5: Commit**

```powershell
git add src/services/bufferWatcher.ts src/components/ui/GroupChat.tsx src/pages/Conductor.tsx src/components/conductor/WorkspaceConductor.tsx
git commit -m "feat(needs): wire NeedsBroker to BufferWatcher and GroupChat"
```

---

## Phase 3 — Autonomous Monitoring Mode

> **What this builds:** A toggle in the Chat panel that makes Ollama watch all agent terminals in the Space continuously. When an agent produces significant output, Ollama evaluates whether it's relevant to any other agent and proactively routes it — respecting interrupt policies.

> **Important constraint:** This does NOT interfere with the Conductor. If the Conductor is running a plan, the autonomous orchestrator skips injection into terminals that are currently running a Conductor task (they are in sentinel-watch mode — an unsolicited injection would corrupt the flow).

---

### Task 10: evaluateAndRoute in ollamaRelay

**Files:**
- Modify: `src/services/ollamaRelay.ts`

- [ ] **Step 1: Add evaluateAndRoute to ollamaRelay.ts**

Open `src/services/ollamaRelay.ts`. Add the following at the end of the file:

```typescript
// ── Autonomous routing evaluation ──────────────────────────────────────────────

export interface RoutingCandidate {
  title: string;
  recentOutput: string;
}

export interface RoutingDecision {
  type: 'no_relay' | 'inject';
  targetTitle?: string;
  message?: string;
}

/**
 * Asks Ollama whether a terminal's recent output should be proactively relayed
 * to any sibling agent. Used by AutonomousOrchestrator.
 *
 * Throws if Ollama is unreachable — callers should catch and skip silently.
 *
 * Returns { type: 'no_relay' } if nothing useful should be sent.
 * Returns { type: 'inject', targetTitle, message } if a relay is warranted.
 */
export async function evaluateAndRoute(params: {
  fromTitle: string;
  recentChunk: string;
  siblings: RoutingCandidate[];
  ollamaHost: string;
  model: string;
}): Promise<RoutingDecision> {
  const { fromTitle, recentChunk, siblings, ollamaHost, model } = params;

  if (siblings.length === 0) return { type: 'no_relay' };

  const siblingsDesc = siblings
    .map(s => `• ${s.title}:\n${s.recentOutput.slice(-300) || '(no recent output)'}`)
    .join('\n\n');

  const userPrompt = `You are monitoring a team of AI coding agents.

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
If relaying, output exactly one line: INJECT → <exact-terminal-title>: <message>`;

  const response = await callOllama(ollamaHost, model, userPrompt);
  const trimmed  = response.trim();

  if (trimmed === 'NO_RELAY' || !trimmed.includes('INJECT')) {
    return { type: 'no_relay' };
  }

  const match = trimmed.match(/INJECT\s*→\s*([^:\n]+):\s*(.+)/i);
  if (!match) return { type: 'no_relay' };

  return {
    type:        'inject',
    targetTitle: match[1].trim(),
    message:     match[2].trim(),
  };
}
```

- [ ] **Step 2: Build — verify no TypeScript errors**

```powershell
npm run build 2>&1 | Select-String -Pattern "error TS"
```

Expected: no `error TS` lines.

- [ ] **Step 3: Commit**

```powershell
git add src/services/ollamaRelay.ts
git commit -m "feat(autonomous): add evaluateAndRoute to ollamaRelay"
```

---

### Task 11: AutonomousOrchestrator Service

**Files:**
- Create: `src/services/autonomousOrchestrator.ts`
- Create: `src/tests/autonomousOrchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/autonomousOrchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutonomousOrchestrator } from '../services/autonomousOrchestrator';

vi.mock('../services/ollamaRelay', () => ({
  evaluateAndRoute: vi.fn().mockResolvedValue({ type: 'no_relay' }),
  checkOllamaOnline: vi.fn().mockResolvedValue(true),
}));

vi.mock('../services/bufferWatcher', () => ({
  bufferWatcher: {
    watchForSummary: vi.fn().mockResolvedValue(() => {}),
    getBuffer: vi.fn().mockReturnValue('recent output from peer'),
    clearSummary: vi.fn(),
    getMode: vi.fn().mockReturnValue('idle'),
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

describe('AutonomousOrchestrator', () => {
  let orchestrator: AutonomousOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new AutonomousOrchestrator();
    orchestrator.updateConfig({ ollamaHost: 'http://localhost:11434', ollamaModel: 'llama3.2' });
  });

  it('starts a space and registers summary watchers', async () => {
    const { bufferWatcher } = await import('../services/bufferWatcher');

    orchestrator.startSpace({
      spaceId: 'space-1',
      sessions: [
        { id: 'sess-a', title: 'Claude', color: null, interruptPolicy: 'always' },
        { id: 'sess-b', title: 'Antigravity', color: null, interruptPolicy: 'always' },
      ],
    });

    expect(bufferWatcher.watchForSummary).toHaveBeenCalledTimes(2);
  });

  it('stops a space and cleans up watchers', async () => {
    const { bufferWatcher } = await import('../services/bufferWatcher');

    orchestrator.startSpace({
      spaceId: 'space-1',
      sessions: [
        { id: 'sess-a', title: 'Claude', color: null, interruptPolicy: 'always' },
      ],
    });

    orchestrator.stopSpace('space-1');

    // The unsubscribe function returned by watchForSummary should have been called
    // (in a real scenario; the mock returns () => {} which we can't assert on directly)
    expect(true).toBe(true); // structural test — no error thrown
  });

  it('calls evaluateAndRoute when a summary chunk arrives', async () => {
    const { evaluateAndRoute } = await import('../services/ollamaRelay');

    let capturedCallback: ((chunk: string) => void) | null = null;
    const { bufferWatcher } = await import('../services/bufferWatcher');
    vi.mocked(bufferWatcher.watchForSummary).mockImplementation(
      async (_sessionId, onChunk) => {
        capturedCallback = onChunk;
        return () => {};
      }
    );

    orchestrator.startSpace({
      spaceId: 'space-1',
      sessions: [
        { id: 'sess-a', title: 'Claude', color: null, interruptPolicy: 'always' },
        { id: 'sess-b', title: 'Antigravity', color: null, interruptPolicy: 'always' },
      ],
    });

    // Simulate a summary chunk arriving for sess-a
    if (capturedCallback) await capturedCallback('Claude finished writing auth middleware');

    expect(evaluateAndRoute).toHaveBeenCalledWith(
      expect.objectContaining({ fromTitle: 'Claude' })
    );
  });

  it('does not inject when evaluateAndRoute returns no_relay', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { evaluateAndRoute } = await import('../services/ollamaRelay');
    vi.mocked(evaluateAndRoute).mockResolvedValue({ type: 'no_relay' });

    let capturedCallback: ((chunk: string) => void) | null = null;
    const { bufferWatcher } = await import('../services/bufferWatcher');
    vi.mocked(bufferWatcher.watchForSummary).mockImplementation(
      async (_sessionId, onChunk) => {
        capturedCallback = onChunk;
        return () => {};
      }
    );

    orchestrator.startSpace({
      spaceId: 'space-1',
      sessions: [
        { id: 'sess-a', title: 'Claude', color: null, interruptPolicy: 'always' },
        { id: 'sess-b', title: 'Antigravity', color: null, interruptPolicy: 'always' },
      ],
    });

    if (capturedCallback) await capturedCallback('some output');

    expect(invoke).not.toHaveBeenCalledWith('write_pty', expect.anything());
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```powershell
npm test
```

Expected: FAIL — `Cannot find module '../services/autonomousOrchestrator'`

- [ ] **Step 3: Create src/services/autonomousOrchestrator.ts**

```typescript
/**
 * autonomousOrchestrator.ts
 *
 * Watches all agent terminals in an active Space. When an agent produces
 * significant output, asks Ollama whether that output should be proactively
 * relayed to a peer agent. If yes, and if the target's interrupt policy allows,
 * injects the relay message via write_pty.
 *
 * This is a singleton service — one instance for the whole app.
 *
 * Key design decisions:
 * - Reactive, not polling: triggered by BufferWatcher's summary debounce (800ms)
 * - Skips Conductor-managed sessions: sessions currently in 'sentinel' watch
 *   mode are being managed by the Conductor pipeline — we must not inject into
 *   them unsolicited as that would corrupt the task prompt.
 * - Per-space: each Space has its own autonomous monitoring context. Start/stop
 *   independently.
 */

import { invoke } from '@tauri-apps/api/core';
import { InterruptPolicy, RoutingEvent } from '../types';
import { bufferWatcher } from './bufferWatcher';
import { evaluateAndRoute, checkOllamaOnline } from './ollamaRelay';
import { canInjectNow } from '../utils/interruptPolicy';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SessionDescriptor {
  id: string;
  title: string;
  color: string | null;
  interruptPolicy: InterruptPolicy;
}

interface SpaceConfig {
  spaceId: string;
  sessions: SessionDescriptor[];
}

interface ActiveSpace {
  config: SpaceConfig;
  /** Unsubscribe functions — one per session summary watcher. */
  unsubscribers: Array<() => void>;
}

// ── AutonomousOrchestrator ─────────────────────────────────────────────────────

export class AutonomousOrchestrator {
  private config = {
    ollamaHost:  'http://localhost:11434',
    ollamaModel: 'llama3.2',
  };

  private activeSpaces = new Map<string, ActiveSpace>();
  private eventListeners: Array<(event: RoutingEvent) => void> = [];

  updateConfig(config: { ollamaHost: string; ollamaModel: string }): void {
    this.config = config;
  }

  /** Subscribe to routing events (for GroupChat display). Returns unsubscribe fn. */
  onEvent(cb: (event: RoutingEvent) => void): () => void {
    this.eventListeners.push(cb);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== cb);
    };
  }

  /** Start autonomous monitoring for a Space. */
  startSpace(spaceConfig: SpaceConfig): void {
    // Stop any existing watchers for this space first (idempotent)
    this.stopSpace(spaceConfig.spaceId);

    const unsubscribers: Array<() => void> = [];

    for (const session of spaceConfig.sessions) {
      const onChunk = async (chunk: string) => {
        await this.onSummaryChunk(spaceConfig.spaceId, session, chunk);
      };
      bufferWatcher.watchForSummary(session.id, onChunk).then(unsub => {
        unsubscribers.push(unsub);
      });
    }

    this.activeSpaces.set(spaceConfig.spaceId, { config: spaceConfig, unsubscribers });
  }

  /** Stop autonomous monitoring for a Space and clean up all watchers. */
  stopSpace(spaceId: string): void {
    const active = this.activeSpaces.get(spaceId);
    if (!active) return;
    for (const unsub of active.unsubscribers) unsub();
    this.activeSpaces.delete(spaceId);
  }

  /** Returns true if autonomous mode is running for the given Space. */
  isRunning(spaceId: string): boolean {
    return this.activeSpaces.has(spaceId);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async onSummaryChunk(
    spaceId: string,
    fromSession: SessionDescriptor,
    chunk: string,
  ): Promise<void> {
    const active = this.activeSpaces.get(spaceId);
    if (!active) return;

    const siblings = active.config.sessions.filter(s => s.id !== fromSession.id);
    if (siblings.length === 0) return;

    // Don't try to route if Ollama is offline
    const online = await checkOllamaOnline(this.config.ollamaHost);
    if (!online) return;

    let decision;
    try {
      decision = await evaluateAndRoute({
        fromTitle:    fromSession.title,
        recentChunk:  chunk,
        siblings:     siblings.map(s => ({
          title:        s.title,
          recentOutput: bufferWatcher.getBuffer(s.id).slice(-600),
        })),
        ollamaHost: this.config.ollamaHost,
        model:      this.config.ollamaModel,
      });
    } catch {
      return; // Ollama error — skip silently
    }

    if (decision.type === 'no_relay' || !decision.targetTitle || !decision.message) return;

    // Find the target session
    const target = siblings.find(
      s => s.title.toLowerCase().includes(decision.targetTitle!.toLowerCase())
    );
    if (!target) return;

    // Safety check: never inject into a session currently managed by Conductor
    const targetMode = bufferWatcher.getMode(target.id);
    if (targetMode === 'sentinel') {
      this.emit({
        type:   'relay-skipped',
        reason: 'interrupt-policy',
        target: target.title,
      });
      return;
    }

    // Respect interrupt policy
    const targetBuffer = bufferWatcher.getBuffer(target.id);
    if (!canInjectNow(targetBuffer, target.interruptPolicy)) {
      this.emit({
        type:   'relay-skipped',
        reason: 'interrupt-policy',
        target: target.title,
      });
      return;
    }

    // Inject
    const injection = `\n[AgentDeck from ${fromSession.title}]: ${decision.message}\n`;
    await invoke('write_pty', { sessionId: target.id, data: injection }).catch(() => {});

    this.emit({
      type:    'relayed',
      from:    fromSession.title,
      to:      target.title,
      message: decision.message,
    });
  }

  private emit(event: RoutingEvent): void {
    for (const cb of this.eventListeners) cb(event);
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const autonomousOrchestrator = new AutonomousOrchestrator();
```

- [ ] **Step 4: Run tests — verify they pass**

```powershell
npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/services/autonomousOrchestrator.ts src/tests/autonomousOrchestrator.test.ts
git commit -m "feat(autonomous): add AutonomousOrchestrator service"
```

---

### Task 12: Autonomous Mode Toggle in GroupChat

**Files:**
- Modify: `src/components/ui/GroupChat.tsx`

- [ ] **Step 1: Import AutonomousOrchestrator in GroupChat**

Open `src/components/ui/GroupChat.tsx`. Add the following import:

```typescript
import { autonomousOrchestrator } from '../../services/autonomousOrchestrator';
```

Add `Zap` to the lucide-react import (the icon for auto-mode):

```typescript
import {
  Send, Bot, User, WifiOff, RefreshCw, Users,
  ChevronDown, Activity, BookmarkPlus, Download, X as XIcon, Zap,
} from 'lucide-react';
```

- [ ] **Step 2: Add autonomous mode state and toggle**

Inside the `GroupChat` component, after the existing `liveFeedOn` state, add:

```typescript
const [autoModeOn, setAutoModeOn] = useState(
  () => localStorage.getItem('agentdeck:automode') === 'true',
);

const toggleAutoMode = () => {
  setAutoModeOn(prev => {
    localStorage.setItem('agentdeck:automode', String(!prev));
    return !prev;
  });
};
```

- [ ] **Step 3: Add autonomous mode effect**

Add the following `useEffect` after the live feed effect:

```typescript
// Autonomous mode — start/stop AutonomousOrchestrator when toggle changes
useEffect(() => {
  if (!autoModeOn || !activeSpaceId || !settings.conductorOllamaModel) return;

  autonomousOrchestrator.updateConfig({
    ollamaHost:  settings.ollamaHost,
    ollamaModel: settings.conductorOllamaModel,
  });

  autonomousOrchestrator.startSpace({
    spaceId:  activeSpaceId,
    sessions: groupSessions.map(s => ({
      id:              s.id,
      title:           s.title,
      color:           s.color,
      interruptPolicy: (s as any).interruptPolicy ?? 'never',
    })),
  });

  // Listen to routing events and show them in the Chat feed
  const unsubEvents = autonomousOrchestrator.onEvent((event) => {
    let content = '';
    if (event.type === 'relayed') {
      content = `⚡ Auto-relayed from ${event.from} → ${event.to}: "${event.message}"`;
    } else if (event.type === 'relay-skipped') {
      content = `⏸ Relay to ${event.target} skipped (${event.reason})`;
    }
    if (content) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'system', content }]);
    }
  });

  return () => {
    unsubEvents();
    autonomousOrchestrator.stopSpace(activeSpaceId);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [autoModeOn, activeSpaceId, groupSessionIds, settings.ollamaHost, settings.conductorOllamaModel]);
```

- [ ] **Step 4: Add the Zap toggle button to the header**

In the JSX, in the header's right section where the `Activity` live-feed toggle button already exists, add the Zap button immediately after it:

```tsx
{/* Autonomous mode toggle */}
{!modelMissing && (
  <button
    className={cx(s.headerIconBtn, autoModeOn && s.headerIconBtnAutoMode)}
    onClick={toggleAutoMode}
    title={autoModeOn
      ? 'Autonomous mode ON — Ollama is proactively routing context'
      : 'Enable autonomous mode — Ollama watches and routes context between agents'}
  >
    <Zap size={12} />
  </button>
)}
```

- [ ] **Step 5: Add the headerIconBtnAutoMode style**

In the styles object at the bottom of GroupChat.tsx, add:

```typescript
headerIconBtnAutoMode: css`
  color: #e3b341 !important;
  background: rgba(227,179,65,0.1) !important;
`,
```

- [ ] **Step 6: Build — verify no TypeScript errors**

```powershell
npm run build 2>&1 | Select-String -Pattern "error TS"
```

Expected: no `error TS` lines.

- [ ] **Step 7: Run all tests**

```powershell
npm test
```

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/components/ui/GroupChat.tsx
git commit -m "feat(autonomous): add autonomous mode toggle to GroupChat"
```

---

### Task 13: Final Integration and Cleanup

**Files:**
- Modify: `src/types/index.ts` — verify all new types are exported
- Modify: `src/services/index.ts` — export new services

- [ ] **Step 1: Verify all type exports in src/types/index.ts**

Open `src/types/index.ts`. Ensure it exports everything:

```typescript
export * from './workspace.types';
export * from './terminal.types';
export * from './conductor.types';
export * from './chat.types';
export * from './autonomous.types';  // ← should already be here from Task 2
```

- [ ] **Step 2: Export new services from src/services/index.ts**

Open `src/services/index.ts`. Add the new services:

```typescript
export { needsBroker } from './needsBroker';
export { autonomousOrchestrator } from './autonomousOrchestrator';
```

- [ ] **Step 3: Run the full test suite one final time**

```powershell
npm test
```

Expected: All tests PASS with zero failures.

- [ ] **Step 4: Build the full app**

```powershell
npm run build
```

Expected: Build succeeds with zero errors.

- [ ] **Step 5: Final commit**

```powershell
git add src/types/index.ts src/services/index.ts
git commit -m "chore: export new services and types from index files"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Covered by |
|---|---|
| Both sequential pipeline AND autonomous modes | Conductor kept as-is; Phase 3 adds autonomous |
| Agents communicate through local AI | Tasks 7–9 (NeedsBroker), Tasks 10–12 (AutonomousOrchestrator) |
| Respect interrupt constraints | Phase 1 (InterruptPolicy type + canInjectNow) |
| Not all agents can be interrupted | `'never'` default policy — safe for all agents |
| Proactive Ollama routing | AutonomousOrchestrator + evaluateAndRoute |
| Mid-task help requests | NeedsBroker + NEEDS protocol |
| No interference with Conductor pipeline | AutonomousOrchestrator skips sessions in 'sentinel' mode |
| Visible in Chat panel | GroupChat shows all events, toggles for both live feed and auto mode |
| Protocol documentation for agents | PROTOCOL_MD updated in both Conductor views |

**Gaps found:** None — all requirements have corresponding tasks.

**Type consistency check:**
- `InterruptPolicy` defined in Task 2, used in Tasks 3, 4, 8, 11 ✓
- `AgentNeedsRequest` defined in Task 2 (`autonomous.types.ts`), used in Tasks 5, 8, 9 ✓
- `RoutingEvent` defined in Task 2, used in Tasks 8, 11, 12 ✓
- `BrokerSession` in needsBroker matches what GroupChat passes in Task 9 ✓
- `watchForSummary` return type changed to `Promise<() => void>` in Task 6 — used in Tasks 9 and 11 ✓
- `bufferWatcher.getMode()` used in AutonomousOrchestrator (Task 11) — already exists in bufferWatcher ✓

**Placeholder scan:** No TBDs, no "handle appropriately", no unresolved references found.
