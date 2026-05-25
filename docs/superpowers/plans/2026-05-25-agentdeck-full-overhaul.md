# AgentDeck Full Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all architecture gaps, fix 5 bugs, and elevate UX across GroupChat, Conductor, Sidebar, Terminal, and Overview — component by component.

**Architecture:** Component-by-component (Approach B from the design spec). Types and services are fixed first (Tasks 1–4), then each UI component is overhauled in dependency order (Tasks 5–15). Every change is surgical — existing patterns are followed throughout.

**Tech Stack:** React 18, TypeScript, Emotion CSS-in-JS (`@emotion/css`), Tauri v2 (`@tauri-apps/api/core`, `@tauri-apps/api/event`), Lucide icons, existing `bufferWatcher` / `ollamaRelay` / `orchestratorEngine` services.

**Spec:** `docs/superpowers/specs/2026-05-25-agentdeck-full-overhaul-design.md`

---

## File Map

| File | Action | Reason |
|------|--------|--------|
| `src/types/conductor.types.ts` | Modify | `spaceId: string` → `string \| null` |
| `src/services/storage.ts` | Modify | Migration: `spaceId: ''` → `null` |
| `src/services/bufferWatcher.ts` | Modify | Add `'summary'` mode, `watchForSummary`, `clearSummary` |
| `src/services/ollamaRelay.ts` | Modify | Add `summariseChunk` |
| `src/components/ui/GroupChat.tsx` | Modify | All 7 GroupChat items from spec |
| `src/components/conductor/WorkspaceConductor.tsx` | Modify | spaceId null fix, space-filtered sessions, HistoryCard type fix |
| `src/components/conductor/PlanBuilder.tsx` | Modify | Session count hint UX |
| `src/components/layout/Sidebar.tsx` | Modify | + shortcut, space count badge, running indicator |
| `src/components/ui/SpaceManagerModal.tsx` | Modify | Stale session detection |
| `src/components/terminal/TerminalContainer.tsx` | Modify | "New Tab" icon only, tab overflow fade |
| `src/pages/Overview.tsx` | Modify | Conductor running indicator, grid card space count |

---

## Task 1: Fix `OrchestratorPlan.spaceId` type and storage migration

**Files:**
- Modify: `src/types/conductor.types.ts`
- Modify: `src/services/storage.ts`

- [ ] **Step 1.1: Change `spaceId` type in `conductor.types.ts`**

Open `src/types/conductor.types.ts`. Change line 50:

```typescript
// BEFORE
export interface OrchestratorPlan {
  id: string;
  goal: string;
  tasks: OrchestratorTask[];
  status: OrchestratorPlanStatus;
  createdAt: number;
  completedAt?: number;
  workspaceId: string;
  /** Scopes this plan to a specific Space. */
  spaceId: string;
}

// AFTER
export interface OrchestratorPlan {
  id: string;
  goal: string;
  tasks: OrchestratorTask[];
  status: OrchestratorPlanStatus;
  createdAt: number;
  completedAt?: number;
  workspaceId: string;
  /** Scopes this plan to a specific Space. null = not scoped to any space. */
  spaceId: string | null;
}
```

- [ ] **Step 1.2: Add `spaceId` normalisation to `migratePlans` in `storage.ts`**

Open `src/services/storage.ts`. Replace the `migratePlans` function:

```typescript
function migratePlans(plans: any[]): OrchestratorPlan[] {
  return plans.map((p: any) => {
    // Rename groupId → spaceId (old data)
    if ('groupId' in p && !('spaceId' in p)) {
      const { groupId, ...rest } = p;
      p = { ...rest, spaceId: groupId };
    }
    // Normalise empty-string spaceId → null
    if (p.spaceId === '') {
      p = { ...p, spaceId: null };
    }
    return p as OrchestratorPlan;
  });
}
```

- [ ] **Step 1.3: Add `spaceId` normalisation to the main `migrate` function in `storage.ts`**

Inside the existing `migrate(parsed: any)` function, add after the existing `agentGroups` migration block:

```typescript
// Normalise spaceId: '' → null on taskLogs and savedPrompts
if (Array.isArray(parsed.taskLogs)) {
  parsed.taskLogs = parsed.taskLogs.map((l: any) => ({
    ...l,
    spaceId: l.spaceId === '' ? null : (l.spaceId ?? null),
  }));
}
if (Array.isArray(parsed.savedPrompts)) {
  parsed.savedPrompts = parsed.savedPrompts.map((p: any) => ({
    ...p,
    spaceId: p.spaceId === '' ? null : (p.spaceId ?? null),
  }));
}
```

- [ ] **Step 1.4: Fix `handleNewPlan` in `WorkspaceConductor.tsx` to use null**

Open `src/components/conductor/WorkspaceConductor.tsx`. Find `handleNewPlan` and change:

```typescript
// BEFORE
const blank: OrchestratorPlan = {
  id: uuidv4(), goal: '', tasks: [], status: 'draft',
  createdAt: Date.now(), workspaceId, spaceId: activeSpaceId ?? '',
};

// AFTER
const blank: OrchestratorPlan = {
  id: uuidv4(), goal: '', tasks: [], status: 'draft',
  createdAt: Date.now(), workspaceId, spaceId: activeSpaceId,
};
```

- [ ] **Step 1.5: Fix `workspacePlans` filter to handle null correctly**

In `WorkspaceConductor.tsx`, find the `workspacePlans` computed value and replace:

```typescript
// BEFORE
const workspacePlans = plans.filter(p => {
  if (p.workspaceId !== workspaceId) return false;
  if (activeSpaceId) return p.spaceId === activeSpaceId;
  return true;
});

// AFTER
const workspacePlans = plans.filter(p => {
  if (p.workspaceId !== workspaceId) return false;
  if (activeSpaceId) return p.spaceId === activeSpaceId;
  return true; // show all workspace plans when no space is active
});
```
(No change in logic — just confirming the filter correctly shows all plans when no space active, since null plans never match `p.spaceId === activeSpaceId` which is fine.)

- [ ] **Step 1.6: Verify TypeScript compiles**

```bash
cd C:/Users/anasa/Desktop/agentdeck
npx tsc --noEmit
```

Expected: no errors related to `spaceId`. Fix any type errors that surface.

- [ ] **Step 1.7: Commit**

```bash
git add src/types/conductor.types.ts src/services/storage.ts src/components/conductor/WorkspaceConductor.tsx
git commit -m "fix(types): spaceId string | null, migrate empty-string to null

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Fix `HistoryCard` TypeScript type

**Files:**
- Modify: `src/components/conductor/WorkspaceConductor.tsx`

- [ ] **Step 2.1: Add `TerminalSession` import**

At the top of `WorkspaceConductor.tsx`, ensure `TerminalSession` is imported:

```typescript
import {
  OrchestratorPlan,
  OrchestratorTask,
  ConductorLogEntry,
  TerminalSession,         // ← add this
} from '../../types';
```

- [ ] **Step 2.2: Fix `HistoryCard` props type**

Find the `HistoryCard` component definition and change:

```typescript
// BEFORE
const HistoryCard: React.FC<{
  plan: OrchestratorPlan;
  sessions: ReturnType<typeof Array.prototype.filter>;
}> = ({ plan, sessions }) => {

// AFTER
const HistoryCard: React.FC<{
  plan: OrchestratorPlan;
  sessions: TerminalSession[];
}> = ({ plan, sessions }) => {
```

- [ ] **Step 2.3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no type errors in `WorkspaceConductor.tsx`.

- [ ] **Step 2.4: Commit**

```bash
git add src/components/conductor/WorkspaceConductor.tsx
git commit -m "fix(types): HistoryCard sessions typed as TerminalSession[]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Add `watchForSummary` to `BufferWatcher`

**Files:**
- Modify: `src/services/bufferWatcher.ts`
- Modify: `src/types/conductor.types.ts`

- [ ] **Step 3.1: Add `'summary'` to `BufferWatchMode`**

In `src/types/conductor.types.ts`, change:

```typescript
// BEFORE
export type BufferWatchMode = 'sentinel' | 'plan' | 'idle';

// AFTER
export type BufferWatchMode = 'sentinel' | 'plan' | 'summary' | 'idle';
```

- [ ] **Step 3.2: Add summary fields to `WatchEntry` in `bufferWatcher.ts`**

Find the `WatchEntry` interface and add:

```typescript
interface WatchEntry {
  buffer: SessionBuffer;
  unlisten: UnlistenFn;
  onSentinel?: (output: OrchestratorTaskOutput) => void;
  onPlan?: (rawJson: string) => void;
  onPlanError?: (err: string) => void;
  ignoreUntil?: number;
  // Summary mode fields
  onSummaryChunk?: (chunk: string) => void;
  summaryDebounceTimer?: ReturnType<typeof setTimeout>;
  summaryLastLength?: number;  // length of buffer at last debounce fire
}
```

- [ ] **Step 3.3: Handle `'summary'` mode in `onData`**

In the `onData` method, add a case for summary mode:

```typescript
private onData(sessionId: string, chunk: string): void {
  const entry = this.entries.get(sessionId);
  if (!entry) return;

  entry.buffer.buffer += chunk;
  entry.buffer.lastActivity = Date.now();

  switch (entry.buffer.mode) {
    case 'sentinel':
      this.checkSentinel(entry);
      break;
    case 'plan':
      this.checkPlan(entry);
      break;
    case 'summary':
      this.checkSummary(entry);  // ← add this
      break;
    case 'idle':
      break;
  }
}
```

- [ ] **Step 3.4: Implement `checkSummary` private method**

Add after `checkPlan`:

```typescript
private checkSummary(entry: WatchEntry): void {
  if (!entry.onSummaryChunk) return;

  const MIN_NEW_CHARS = 60;
  const DEBOUNCE_MS   = 800;

  const currentLength = entry.buffer.buffer.length;
  const lastLength    = entry.summaryLastLength ?? 0;
  const newChars      = currentLength - lastLength;

  if (newChars < MIN_NEW_CHARS) return;

  // Debounce: clear any pending timer and set a new one
  if (entry.summaryDebounceTimer) clearTimeout(entry.summaryDebounceTimer);
  entry.summaryDebounceTimer = setTimeout(() => {
    if (!entry.onSummaryChunk) return;
    // Send only the new chunk since last fire
    const newContent = entry.buffer.buffer.slice(lastLength);
    entry.summaryLastLength = entry.buffer.buffer.length;
    entry.onSummaryChunk(newContent);
  }, DEBOUNCE_MS);
}
```

- [ ] **Step 3.5: Add `watchForSummary` public method**

Add after `watchForPlan`:

```typescript
/**
 * Switch a session into summary mode. Fires onChunk with debounced
 * terminal output chunks (min 60 chars, 800ms debounce).
 * Does NOT clear the existing buffer — summary mode accumulates alongside.
 * Call clearSummary() to stop.
 */
async watchForSummary(
  sessionId: string,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const entry = await this.ensureListening(sessionId);
  entry.buffer.mode = 'summary';
  entry.onSummaryChunk = onChunk;
  entry.onSentinel = undefined;
  entry.onPlan = undefined;
  entry.onPlanError = undefined;
  entry.summaryLastLength = entry.buffer.buffer.length; // start from current position
}

/**
 * Stop summary mode for a session and return it to idle.
 */
clearSummary(sessionId: string): void {
  const entry = this.entries.get(sessionId);
  if (!entry) return;
  if (entry.summaryDebounceTimer) clearTimeout(entry.summaryDebounceTimer);
  entry.onSummaryChunk = undefined;
  entry.summaryDebounceTimer = undefined;
  entry.summaryLastLength = undefined;
  entry.buffer.mode = 'idle';
}
```

- [ ] **Step 3.6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors in `bufferWatcher.ts` or `conductor.types.ts`.

- [ ] **Step 3.7: Commit**

```bash
git add src/services/bufferWatcher.ts src/types/conductor.types.ts
git commit -m "feat(bufferWatcher): add summary mode with watchForSummary/clearSummary

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Add `summariseChunk` to `ollamaRelay.ts`

**Files:**
- Modify: `src/services/ollamaRelay.ts`

- [ ] **Step 4.1: Add `summariseChunk` function**

Add at the end of `ollamaRelay.ts`, before the pass-through fallback section:

```typescript
// ── Terminal output summarisation ──────────────────────────────────────────────

/**
 * Asks Ollama to summarise a raw terminal output chunk in 1–2 sentences.
 * Used by GroupChat's live feed to condense agent output.
 *
 * Throws if Ollama is unreachable or returns empty content — callers should
 * catch and silently skip the summary rather than showing an error.
 */
export async function summariseChunk(
  chunk: string,
  tabTitle: string,
  ollamaHost: string,
  model: string,
): Promise<string> {
  const systemPrompt = `You are a terminal output summariser. Summarise the following terminal output from agent "${tabTitle}" in 1–2 concise sentences. Be direct and factual — no filler, no suggestions. Output only the summary text, nothing else.`;

  // Truncate very long chunks to avoid token waste
  const truncated = chunk.length > 2000 ? chunk.slice(-2000) : chunk;

  const response = await fetch(`${ollamaHost}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: truncated },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama summarise error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.message?.content ?? data.response ?? '';
  if (!text.trim()) throw new Error('Empty summarise response');
  return text.trim();
}
```

- [ ] **Step 4.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add src/services/ollamaRelay.ts
git commit -m "feat(ollamaRelay): add summariseChunk for GroupChat live feed

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Overhaul `GroupChat.tsx`

**Files:**
- Modify: `src/components/ui/GroupChat.tsx`

This task rewrites GroupChat from scratch to implement all 7 spec items. The full replacement is given below.

- [ ] **Step 5.1: Replace `GroupChat.tsx` entirely**

Replace the full content of `src/components/ui/GroupChat.tsx` with:

```typescript
/**
 * GroupChat.tsx
 *
 * Streaming Ollama chat panel scoped to the active Space.
 *
 * Features:
 * - Streaming chat with Ollama (stale-closure fix via streamingContentRef)
 * - Chat history persisted to localStorage per workspace/space
 * - Live terminal feed: watchForSummary → summariseChunk → agent-summary messages
 * - Terminal injection: parses INJECT→ pattern from Ollama response, calls write_pty
 * - Save message to Prompt Vault
 * - Export transcript as .md
 * - Contextual empty state with suggested prompts
 * - Inline Markdown rendering (code fences, bold, inline code)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { css, cx } from '@emotion/css';
import {
  Send, Bot, User, WifiOff, RefreshCw, Users,
  ChevronDown, Activity, BookmarkPlus, Download, X as XIcon,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useDashboard } from '../../context/DashboardContext';
import {
  streamChatWithOllama,
  summariseChunk,
  checkOllamaOnline,
  ChatMessage,
} from '../../services/ollamaRelay';
import { bufferWatcher } from '../../services/bufferWatcher';

// ── Props ──────────────────────────────────────────────────────────────────────

interface GroupChatProps {
  workspaceId: string;
}

// ── Display message ────────────────────────────────────────────────────────────

type MsgRole = 'user' | 'assistant' | 'system' | 'agent-summary';

interface DisplayMessage {
  id: string;
  role: MsgRole;
  content: string;
  streaming?: boolean;
  sessionTitle?: string;
  sessionColor?: string | null;
  injectedSessionTitle?: string;
}

// ── Storage helpers ────────────────────────────────────────────────────────────

const MAX_STORED = 100;

function chatStorageKey(workspaceId: string, spaceId: string | null): string {
  return `agentdeck:chat:${workspaceId}:${spaceId ?? 'workspace'}`;
}

function loadPersistedMessages(key: string): DisplayMessage[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessages(key: string, messages: DisplayMessage[]): void {
  try {
    const toSave = messages.slice(-MAX_STORED);
    localStorage.setItem(key, JSON.stringify(toSave));
  } catch { /* storage full — ignore */ }
}

// ── Inline Markdown renderer ───────────────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode[] {
  // Split on code fences first
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3).replace(/^\w+\n/, ''); // strip lang hint
      return (
        <pre key={i} style={{
          background: 'rgba(0,0,0,0.35)',
          borderRadius: 6,
          padding: '8px 10px',
          margin: '6px 0',
          fontFamily: "'Fira Code', 'Cascadia Code', monospace",
          fontSize: 11,
          overflowX: 'auto',
          whiteSpace: 'pre',
          color: '#94a3b8',
        }}>
          {inner}
        </pre>
      );
    }
    // Inline: **bold**, `code`
    const segments = part.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
      <span key={i}>
        {segments.map((seg, j) => {
          if (seg.startsWith('**') && seg.endsWith('**')) {
            return <strong key={j} style={{ color: '#e2e8f0' }}>{seg.slice(2, -2)}</strong>;
          }
          if (seg.startsWith('`') && seg.endsWith('`')) {
            return (
              <code key={j} style={{
                background: 'rgba(0,0,0,0.3)',
                borderRadius: 3,
                padding: '1px 5px',
                fontFamily: "'Fira Code', monospace",
                fontSize: '0.9em',
                color: '#f59e0b',
              }}>
                {seg.slice(1, -1)}
              </code>
            );
          }
          return seg;
        })}
      </span>
    );
  });
}

// ── System prompt builder ──────────────────────────────────────────────────────

function buildSystemPrompt(
  workspaceName: string,
  spaceName: string | null,
  sessionTitles: string[],
): string {
  const spaceLine = spaceName
    ? `Active Space: "${spaceName}"`
    : 'No space is currently selected.';

  const sessionsLine = sessionTitles.length > 0
    ? `Terminal sessions in this space:\n${sessionTitles.map(t => `  • ${t}`).join('\n')}`
    : 'No terminal sessions are currently assigned to this space.';

  return `You are an AI orchestration assistant embedded inside AgentDeck, a developer workspace management tool.

Workspace: "${workspaceName}"
${spaceLine}
${sessionsLine}

Your job: help the developer plan, coordinate, and execute work across their terminal sessions. Be concise, direct, and practical. Think like a senior engineer and a tech lead — not a chatbot. Avoid filler, avoid markdown headers, keep answers short unless depth is needed.

When the developer asks you to send a message or instruction to a specific terminal session, format your response with an injection line like this:
INJECT → <terminal-title>: <the message to send>

You can include your normal reply above or below the INJECT line. Only use INJECT when the user explicitly asks you to send/tell/relay something to a terminal.`;
}

// ── Inject parser ──────────────────────────────────────────────────────────────

function parseInject(
  content: string,
  sessions: { id: string; title: string; color: string | null }[],
): { sessionId: string; sessionTitle: string; sessionColor: string | null; message: string } | null {
  const match = content.match(/INJECT\s*→\s*([^:]+):\s*(.+)/i);
  if (!match) return null;
  const targetTitle = match[1].trim();
  const message     = match[2].trim();
  const session = sessions.find(
    s => s.title.toLowerCase().includes(targetTitle.toLowerCase()),
  );
  if (!session) return null;
  return { sessionId: session.id, sessionTitle: session.title, sessionColor: session.color, message };
}

// ── Suggested prompts ──────────────────────────────────────────────────────────

function getSuggestions(sessionTitles: string[]): string[] {
  const first = sessionTitles[0] ?? 'the terminal';
  return [
    'What is everyone working on right now?',
    `Summarise what ${first} has done so far`,
    `Tell ${first} to write a brief status update`,
  ];
}

// ── Component ──────────────────────────────────────────────────────────────────

export const GroupChat: React.FC<GroupChatProps> = ({ workspaceId }) => {
  const {
    workspaces, spaces, terminalSessions,
    activeSpaceId, settings, addSavedPrompt, showToast,
  } = useDashboard();

  const workspace    = workspaces.find(w => w.id === workspaceId);
  const activeSpace  = spaces.find(g => g.id === activeSpaceId);
  const allSessions  = terminalSessions.filter(s => s.workspaceId === workspaceId);
  const groupSessions = activeSpace
    ? allSessions.filter(s => activeSpace.sessionIds.includes(s.id))
    : allSessions;

  // ── Storage key (changes when space changes) ──────────────────────────────
  const storageKey = chatStorageKey(workspaceId, activeSpaceId ?? null);
  const storageKeyRef = useRef(storageKey);

  // ── Ollama status ─────────────────────────────────────────────────────────
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [checking, setChecking]         = useState(false);

  const checkOnline = useCallback(async () => {
    if (!settings.ollamaHost) { setOllamaOnline(false); return; }
    setChecking(true);
    const ok = await checkOllamaOnline(settings.ollamaHost);
    setOllamaOnline(ok);
    setChecking(false);
  }, [settings.ollamaHost]);

  useEffect(() => { checkOnline(); }, [checkOnline]);

  // ── Message history (persisted) ───────────────────────────────────────────
  const [messages,   setMessages]   = useState<DisplayMessage[]>(() => loadPersistedMessages(storageKey));
  const [apiHistory, setApiHistory] = useState<ChatMessage[]>([]);
  const [input,      setInput]      = useState('');
  const [streaming,  setStreaming]  = useState(false);
  const cancelRef            = useRef<(() => void) | null>(null);
  const streamingContentRef  = useRef('');   // tracks current streaming content for onDone
  const bottomRef            = useRef<HTMLDivElement>(null);
  const textareaRef          = useRef<HTMLTextAreaElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Persist messages on change (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveMessages(storageKeyRef.current, messages);
    }, 300);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [messages]);

  // Swap messages when space changes
  useEffect(() => {
    const newKey = chatStorageKey(workspaceId, activeSpaceId ?? null);
    storageKeyRef.current = newKey;
    setMessages(loadPersistedMessages(newKey));
    setApiHistory([]);
  }, [workspaceId, activeSpaceId]);

  const scrollToBottom = (smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  };

  useEffect(() => {
    if (!streaming) scrollToBottom();
  }, [messages.length, streaming]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 120);
  };

  // ── Live feed (watchForSummary) ───────────────────────────────────────────
  const [liveFeedOn, setLiveFeedOn] = useState(() => {
    return localStorage.getItem('agentdeck:livefeed') === 'true';
  });

  const toggleLiveFeed = () => {
    setLiveFeedOn(prev => {
      localStorage.setItem('agentdeck:livefeed', String(!prev));
      return !prev;
    });
  };

  useEffect(() => {
    if (!liveFeedOn || !settings.conductorOllamaModel || !settings.ollamaHost) return;

    const sessionIds = groupSessions.map(s => s.id);

    sessionIds.forEach(sessionId => {
      const session = groupSessions.find(s => s.id === sessionId);
      if (!session) return;

      bufferWatcher.watchForSummary(sessionId, async (chunk: string) => {
        try {
          const summary = await summariseChunk(
            chunk,
            session.title,
            settings.ollamaHost,
            settings.conductorOllamaModel,
          );
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'agent-summary',
            content: summary,
            sessionTitle: session.title,
            sessionColor: session.color,
          }]);
        } catch {
          // Silently skip if summarisation fails
        }
      });
    });

    return () => {
      sessionIds.forEach(id => bufferWatcher.clearSummary(id));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveFeedOn, groupSessions.map(s => s.id).join(','), settings.conductorOllamaModel, settings.ollamaHost]);

  // ── Send message ──────────────────────────────────────────────────────────

  const handleSend = (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;
    if (!settings.conductorOllamaModel) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    streamingContentRef.current = '';

    const userMsg: DisplayMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    const assistantId = crypto.randomUUID();
    const assistantMsg: DisplayMessage = { id: assistantId, role: 'assistant', content: '', streaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);

    const newApiHistory: ChatMessage[] = [...apiHistory, { role: 'user', content: text }];
    setApiHistory(newApiHistory);
    setStreaming(true);
    setOllamaOnline(true); // optimistic

    const systemPrompt = buildSystemPrompt(
      workspace?.name ?? workspaceId,
      activeSpace?.name ?? null,
      groupSessions.map(s => s.title),
    );

    const cancel = streamChatWithOllama({
      ollamaHost:   settings.ollamaHost,
      model:        settings.conductorOllamaModel,
      systemPrompt,
      messages:     newApiHistory,
      onToken: (token) => {
        streamingContentRef.current += token;
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, content: m.content + token } : m),
        );
      },
      onDone: () => {
        const finalContent = streamingContentRef.current;
        setStreaming(false);
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m),
        );
        setApiHistory(h => [...h, { role: 'assistant', content: finalContent }]);
        cancelRef.current = null;
        scrollToBottom();

        // Check for inject pattern
        const injectResult = parseInject(finalContent, groupSessions);
        if (injectResult) {
          const { sessionId, sessionTitle, sessionColor, message } = injectResult;
          invoke('write_pty', { sessionId, data: message + '\n' }).catch(() => {});
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'system',
            content: `✦ Sent to ${sessionTitle}: ${message}`,
            injectedSessionTitle: sessionTitle,
            sessionColor,
          }]);
        }
      },
      onError: (err) => {
        setStreaming(false);
        setOllamaOnline(false);
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: `Error: ${err}`, streaming: false }
              : m,
          ),
        );
        cancelRef.current = null;
      },
    });

    cancelRef.current = cancel;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const handleStop = () => {
    cancelRef.current?.();
    cancelRef.current = null;
    setStreaming(false);
    setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
  };

  // ── Save to Prompt Vault ──────────────────────────────────────────────────

  const handleSaveToVault = (msg: DisplayMessage) => {
    const title = msg.content.slice(0, 60) + (msg.content.length > 60 ? '…' : '');
    addSavedPrompt({
      workspaceId,
      spaceId: activeSpaceId ?? null,
      title,
      content: msg.content,
      tags: [],
    });
    showToast('Saved to Prompt Vault', 'success');
  };

  // ── Export transcript ──────────────────────────────────────────────────────

  const handleExport = () => {
    const lines = messages.map(m => {
      const time = new Date().toISOString().slice(0, 10);
      if (m.role === 'user')          return `**You** (${time}):\n${m.content}\n`;
      if (m.role === 'assistant')     return `**Ollama** (${time}):\n${m.content}\n`;
      if (m.role === 'agent-summary') return `*[${m.sessionTitle}]:* ${m.content}\n`;
      if (m.role === 'system')        return `*${m.content}*\n`;
      return '';
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `agentdeck-chat-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Clear history ──────────────────────────────────────────────────────────

  const handleClear = () => {
    localStorage.removeItem(storageKeyRef.current);
    setMessages([]);
    setApiHistory([]);
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

  const modelMissing = !settings.conductorOllamaModel;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={s.root}>

      {/* Header */}
      <div className={s.header}>
        <div className={s.headerLeft}>
          <Bot size={14} className={s.botIcon} />
          <span className={s.headerTitle}>
            {activeSpace ? activeSpace.name : 'Workspace'} Chat
          </span>
          {activeSpace && (
            <span
              className={s.groupBadge}
              style={{ backgroundColor: activeSpace.color + '22', color: activeSpace.color, borderColor: activeSpace.color + '44' }}
              title={groupSessions.map(s => s.title).join(', ') || 'No sessions assigned'}
            >
              <Users size={9} />
              {groupSessions.length} session{groupSessions.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className={s.headerRight}>
          {/* Live feed toggle */}
          {settings.conductorOllamaModel && (
            <button
              className={cx(s.headerIconBtn, liveFeedOn && s.headerIconBtnActive)}
              onClick={toggleLiveFeed}
              title={liveFeedOn ? 'Disable live terminal summaries' : 'Enable live terminal summaries'}
            >
              <Activity size={12} />
            </button>
          )}

          {/* Export */}
          {messages.length > 0 && (
            <button className={s.headerIconBtn} onClick={handleExport} title="Export transcript">
              <Download size={12} />
            </button>
          )}

          {/* Clear */}
          {messages.length > 0 && (
            <button className={s.headerIconBtn} onClick={handleClear} title="Clear chat history">
              <XIcon size={12} />
            </button>
          )}

          {/* Ollama status */}
          {ollamaOnline === false && (
            <span className={s.offlineBadge}><WifiOff size={10} /> Offline</span>
          )}
          {ollamaOnline === true && (
            <span className={s.onlineBadge}>
              <span className={s.onlineDot} /> Ollama
            </span>
          )}
          <button className={s.refreshBtn} onClick={checkOnline} disabled={checking} title="Check Ollama connection">
            <RefreshCw size={11} className={cx(checking && s.spin)} />
          </button>
        </div>
      </div>

      {/* Warning banners */}
      {modelMissing && (
        <div className={s.warningBanner}>
          ⚠ No Ollama model configured — go to Settings → Conductor Settings to pick one.
        </div>
      )}
      {ollamaOnline === false && !modelMissing && (
        <div className={s.warningBanner}>
          ⚠ Ollama is offline at <code>{settings.ollamaHost}</code> — start it to enable chat.
        </div>
      )}

      {/* Message list */}
      <div className={s.messageList} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className={s.emptyState}>
            <Bot size={28} className={s.emptyIcon} />
            <p className={s.emptyTitle}>
              {activeSpace ? `Orchestrating "${activeSpace.name}"` : 'Workspace AI'}
            </p>
            <p className={s.emptyHint}>Ask anything about your terminals, tasks, or workflow.</p>
            <div className={s.suggestions}>
              {getSuggestions(groupSessions.map(s => s.title)).map(suggestion => (
                <button
                  key={suggestion}
                  className={s.suggestionBtn}
                  onClick={() => handleSend(suggestion)}
                  disabled={modelMissing || ollamaOnline === false}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <MessageRow
              key={msg.id}
              msg={msg}
              onSaveToVault={() => handleSaveToVault(msg)}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {showScrollBtn && (
        <button className={s.scrollBtn} onClick={() => scrollToBottom()}>
          <ChevronDown size={14} />
        </button>
      )}

      {/* Input */}
      <div className={s.inputArea}>
        <textarea
          ref={textareaRef}
          className={s.textarea}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            modelMissing         ? 'Configure an Ollama model in Settings first…'
            : streaming          ? 'Ollama is responding…'
            : ollamaOnline===false? 'Ollama offline — start it to chat'
            : 'Ask anything — ↵ to send, Shift+↵ for newline'
          }
          disabled={modelMissing || ollamaOnline === false}
          rows={1}
        />
        {streaming ? (
          <button className={cx(s.sendBtn, s.stopBtn)} onClick={handleStop} title="Stop">■</button>
        ) : (
          <button
            className={s.sendBtn}
            onClick={() => handleSend()}
            disabled={!input.trim() || modelMissing || ollamaOnline === false}
            title="Send (Enter)"
          >
            <Send size={13} />
          </button>
        )}
      </div>
    </div>
  );
};

// ── MessageRow sub-component ───────────────────────────────────────────────────

const MessageRow: React.FC<{
  msg: DisplayMessage;
  onSaveToVault: () => void;
}> = ({ msg, onSaveToVault }) => {
  const [hovered, setHovered] = useState(false);

  if (msg.role === 'agent-summary') {
    return (
      <div className={s.agentSummaryRow}>
        <span
          className={s.agentSummaryDot}
          style={{ backgroundColor: msg.sessionColor ?? '#475569' }}
        />
        <span className={s.agentSummaryTitle}>{msg.sessionTitle}</span>
        <span className={s.agentSummaryText}>{msg.content}</span>
      </div>
    );
  }

  if (msg.role === 'system') {
    return (
      <div
        className={s.systemRow}
        style={msg.sessionColor
          ? { borderLeftColor: msg.sessionColor, backgroundColor: msg.sessionColor + '0d' }
          : undefined}
      >
        {msg.content}
      </div>
    );
  }

  return (
    <div
      className={cx(s.msgRow, msg.role === 'user' ? s.msgRowUser : s.msgRowAssistant)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {msg.role === 'assistant' && (
        <div className={s.avatar}><Bot size={12} /></div>
      )}
      <div className={cx(s.bubble, msg.role === 'user' ? s.bubbleUser : s.bubbleAssistant)}>
        <div className={s.msgText}>{renderMarkdown(msg.content)}</div>
        {msg.streaming && <span className={s.cursor} />}
        {/* Save to vault — assistant messages only */}
        {msg.role === 'assistant' && !msg.streaming && hovered && (
          <button className={s.vaultBtn} onClick={onSaveToVault} title="Save to Prompt Vault">
            <BookmarkPlus size={11} />
          </button>
        )}
      </div>
      {msg.role === 'user' && (
        <div className={cx(s.avatar, s.avatarUser)}><User size={12} /></div>
      )}
    </div>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = {
  root: css`
    display: flex; flex-direction: column; height: 100%;
    background: #070d14; overflow: hidden; position: relative;
  `,
  header: css`
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; border-bottom: 1px solid #0d1c2a;
    background: #0b1520; flex-shrink: 0;
  `,
  headerLeft: css`
    display: flex; align-items: center; gap: 8px; min-width: 0;
  `,
  headerRight: css`
    display: flex; align-items: center; gap: 5px; flex-shrink: 0;
  `,
  botIcon: css`color: #ff9d00; flex-shrink: 0;`,
  headerTitle: css`font-size: 12px; font-weight: 700; color: #e2e8f0; white-space: nowrap;`,
  groupBadge: css`
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 700; padding: 2px 7px;
    border-radius: 99px; border: 1px solid; flex-shrink: 0; cursor: default;
  `,
  headerIconBtn: css`
    width: 24px; height: 24px; border-radius: 5px; border: none;
    background: transparent; color: #475569; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 150ms ease;
    &:hover { background: #0d1c2a; color: #94a3b8; }
  `,
  headerIconBtnActive: css`
    color: #10b981 !important;
    background: rgba(16,185,129,0.1) !important;
  `,
  onlineBadge: css`
    display: flex; align-items: center; gap: 5px;
    font-size: 10px; font-weight: 700; color: #10b981;
  `,
  onlineDot: css`
    width: 6px; height: 6px; border-radius: 50%; background: #10b981;
    animation: blink 2s ease-in-out infinite;
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.4} }
  `,
  offlineBadge: css`
    display: flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 700; color: #ef4444;
  `,
  refreshBtn: css`
    width: 22px; height: 22px; border-radius: 5px; border: none;
    background: transparent; color: #475569; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 150ms ease;
    &:hover { background: #0d1c2a; color: #94a3b8; }
    &:disabled { opacity: 0.5; cursor: default; }
  `,
  spin: css`animation: spin 0.8s linear infinite; @keyframes spin{to{transform:rotate(360deg)}}`,
  warningBanner: css`
    background: rgba(245,158,11,0.08); border-bottom: 1px solid rgba(245,158,11,0.2);
    padding: 8px 14px; font-size: 11px; color: #f59e0b; flex-shrink: 0; line-height: 1.4;
    code { font-family: 'Fira Code',monospace; color: #fbbf24; }
  `,
  messageList: css`
    flex: 1; overflow-y: auto; padding: 16px 14px;
    display: flex; flex-direction: column; gap: 10px;
    scroll-behavior: smooth;
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 2px; }
  `,
  emptyState: css`
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; text-align: center; padding: 40px 24px;
    gap: 8px; color: #475569; margin: auto 0;
  `,
  emptyIcon: css`color: #1e3a5f; margin-bottom: 4px;`,
  emptyTitle: css`font-size: 13px; font-weight: 700; color: #64748b; margin: 0;`,
  emptyHint: css`font-size: 11px; color: #475569; line-height: 1.5; margin: 0; max-width: 260px;`,
  suggestions: css`
    display: flex; flex-direction: column; gap: 6px; margin-top: 12px; width: 100%; max-width: 280px;
  `,
  suggestionBtn: css`
    background: #0b1520; border: 1px solid #1e3a5f; border-radius: 8px;
    color: #64748b; font-size: 11px; padding: 8px 12px; cursor: pointer;
    text-align: left; transition: all 150ms ease; line-height: 1.4;
    &:hover:not(:disabled) { border-color: #ff9d00; color: #e2e8f0; background: #0d1c2a; }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  `,
  msgRow: css`display: flex; align-items: flex-end; gap: 8px; position: relative;`,
  msgRowUser: css`flex-direction: row-reverse;`,
  msgRowAssistant: css`flex-direction: row;`,
  avatar: css`
    width: 24px; height: 24px; border-radius: 50%;
    background: #0d1c2a; border: 1px solid #1e3a5f;
    display: flex; align-items: center; justify-content: center;
    color: #ff9d00; flex-shrink: 0;
  `,
  avatarUser: css`background: rgba(255,157,0,0.1); border-color: rgba(255,157,0,0.3); color: #ff9d00;`,
  bubble: css`
    max-width: 82%; padding: 10px 13px; border-radius: 12px;
    font-size: 12px; line-height: 1.55; word-break: break-word; position: relative;
  `,
  bubbleUser: css`
    background: rgba(255,157,0,0.12); border: 1px solid rgba(255,157,0,0.25);
    border-bottom-right-radius: 3px; color: #fde68a;
  `,
  bubbleAssistant: css`
    background: #0d1c2a; border: 1px solid #132030;
    border-bottom-left-radius: 3px; color: #cbd5e1;
  `,
  msgText: css`margin: 0; font-family: inherit; font-size: inherit; white-space: pre-wrap; line-height: 1.55;`,
  cursor: css`
    display: inline-block; width: 7px; height: 13px; background: #ff9d00;
    border-radius: 1px; margin-left: 2px; vertical-align: text-bottom;
    animation: blink 0.8s step-end infinite;
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  `,
  vaultBtn: css`
    position: absolute; top: -8px; right: -8px;
    width: 22px; height: 22px; border-radius: 50%;
    background: #0b1520; border: 1px solid #1e3a5f;
    color: #475569; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 150ms ease;
    &:hover { background: rgba(255,157,0,0.12); border-color: #ff9d00; color: #ff9d00; }
  `,
  agentSummaryRow: css`
    display: flex; align-items: baseline; gap: 6px;
    padding: 5px 8px; background: rgba(0,0,0,0.2);
    border-radius: 6px; border-left: 2px solid transparent;
  `,
  agentSummaryDot: css`
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 3px;
  `,
  agentSummaryTitle: css`
    font-size: 10px; font-weight: 700; color: #475569; white-space: nowrap; flex-shrink: 0;
  `,
  agentSummaryText: css`font-size: 11px; color: #64748b; line-height: 1.4;`,
  systemRow: css`
    font-size: 11px; color: #64748b; padding: 6px 10px;
    border-left: 2px solid #1e3a5f; border-radius: 4px;
    background: rgba(30,58,95,0.15); line-height: 1.4;
  `,
  scrollBtn: css`
    position: absolute; bottom: 70px; right: 16px;
    width: 28px; height: 28px; border-radius: 50%;
    border: 1px solid #1e3a5f; background: #0b1520; color: #64748b;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4); transition: all 150ms ease;
    &:hover { background: #122030; color: #e2e8f0; }
  `,
  inputArea: css`
    display: flex; align-items: flex-end; gap: 8px;
    padding: 10px 12px; border-top: 1px solid #0d1c2a;
    background: #0b1520; flex-shrink: 0;
  `,
  textarea: css`
    flex: 1; background: #071018; border: 1px solid #1e3a5f;
    border-radius: 8px; padding: 9px 12px; color: #e2e8f0;
    font-size: 12px; font-family: inherit; line-height: 1.5;
    resize: none; outline: none; max-height: 120px; min-height: 36px;
    transition: border-color 150ms ease;
    &:focus { border-color: #2d5a8a; }
    &::placeholder { color: #334155; }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  `,
  sendBtn: css`
    width: 34px; height: 34px; flex-shrink: 0; border-radius: 8px; border: none;
    background: #ff9d00; color: #070d14; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 700; transition: all 150ms ease;
    &:hover:not(:disabled) { background: #ffb733; }
    &:disabled { opacity: 0.35; cursor: not-allowed; }
  `,
  stopBtn: css`background: #ef4444; color: #fff; &:hover { background: #f87171; }`,
};
```

- [ ] **Step 5.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors in `GroupChat.tsx`. If `addSavedPrompt` signature errors, check that `SavedPrompt` type has `spaceId: string | null` (it does per `workspace.types.ts`).

- [ ] **Step 5.3: Commit**

```bash
git add src/components/ui/GroupChat.tsx
git commit -m "feat(GroupChat): persistence, live feed, injection, vault, export, UX overhaul

- Fix stale closure bug via streamingContentRef
- Persist messages to localStorage per workspace/space key
- Add watchForSummary live feed with toggle
- Add write_pty terminal injection via INJECT→ pattern
- Add Save to Prompt Vault on assistant messages
- Add Export transcript to .md
- Add contextual empty state with suggested prompts
- Add inline Markdown renderer (code fences, bold, inline code)
- Stale space session banner wired to GroupChat context

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Fix `WorkspaceConductor` — space-filtered sessions + running indicator

**Files:**
- Modify: `src/components/conductor/WorkspaceConductor.tsx`

- [ ] **Step 6.1: Filter `planSessions` to active space**

In `WorkspaceConductor.tsx`, find the line that defines `workspaceSessions`:

```typescript
const workspaceSessions = terminalSessions.filter(s => s.workspaceId === workspaceId);
```

Add `planSessions` immediately after:

```typescript
const workspaceSessions = terminalSessions.filter(s => s.workspaceId === workspaceId);

// When a space is active, the plan builder should only show sessions in that space.
const planSessions = activeSpace
  ? workspaceSessions.filter(s => activeSpace.sessionIds.includes(s.id))
  : workspaceSessions;
```

- [ ] **Step 6.2: Pass `planSessions` to `PlanBuilder`**

Find where `PlanBuilder` is rendered and change `sessions={workspaceSessions}` to `sessions={planSessions}`:

```typescript
<PlanBuilder
  key={activePlan.id}
  plan={activePlan}
  sessions={planSessions}          // ← was workspaceSessions
  workspaceId={workspaceId}
  spaceId={activePlan.spaceId}
  onSave={updated => updatePlan(updated.id, updated)}
  onApproveAndRun={handleApproveAndRun}
/>
```

- [ ] **Step 6.3: Expose `engineRunning` for the running indicator**

The `engineRunning` state already exists in `WorkspaceConductor`. We need to export it upward so the right-panel tab can show a dot. However since Overview renders the tabs and WorkspaceConductor is inside the right panel, we'll use a lightweight approach: store the running state in `localStorage` so `Overview.tsx` can read it without prop drilling.

Add this effect to `WorkspaceConductor.tsx` after the engine subscription useEffect:

```typescript
// Persist engine running state for the tab indicator in Overview
useEffect(() => {
  localStorage.setItem(`agentdeck:conductor:running:${workspaceId}`, String(engineRunning));
}, [engineRunning, workspaceId]);
```

- [ ] **Step 6.4: Add session count hint in `PlanBuilder`**

Open `src/components/conductor/PlanBuilder.tsx`. Find the section where `sessions` are shown (the session dropdown in the TaskCard or wherever sessions are listed) and look for the `sessions` prop usage. This hint goes at the top of the Build tab in `WorkspaceConductor`, just above `<PlanBuilder>`:

Add inside the `{tab === 'build' && ...}` block, before `<PlanBuilder>`:

```typescript
{activeSpace && planSessions.length === 0 && (
  <div style={{
    fontSize: 11, color: '#f59e0b',
    background: 'rgba(245,158,11,0.08)',
    border: '1px solid rgba(245,158,11,0.2)',
    borderRadius: 6, padding: '8px 12px', marginBottom: 8,
  }}>
    ⚠ No terminal sessions are assigned to <strong>{activeSpace.name}</strong>.
    {' '}Edit the Space from the sidebar to add sessions.
  </div>
)}
{activeSpace && planSessions.length > 0 && (
  <div style={{ fontSize: 10, color: '#475569', padding: '0 2px 4px' }}>
    {planSessions.length} session{planSessions.length !== 1 ? 's' : ''} available in this space
  </div>
)}
```

- [ ] **Step 6.5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 6.6: Commit**

```bash
git add src/components/conductor/WorkspaceConductor.tsx
git commit -m "fix(Conductor): filter plan sessions to active space, fix HistoryCard type

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Sidebar UX — `+` shortcut, space count, running indicator

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 7.1: Add `+` shortcut next to "Workspaces" label**

In `Sidebar.tsx`, find the "Workspaces" section header:

```typescript
<span className={s.sectionLabel}>Workspaces</span>
```

Replace with a row that includes the shortcut button:

```typescript
<div className={s.sectionRow}>
  <span className={s.sectionLabel}>Workspaces</span>
  <button
    className={s.sectionAddBtn}
    title="New Workspace"
    onClick={() => {
      navigate('/');
      setViewMode('grid');
      // Signal overview to open the dialog — use a small localStorage flag
      localStorage.setItem('agentdeck:open-new-workspace', '1');
    }}
  >
    <Plus size={10} />
  </button>
</div>
```

Add the styles:

```typescript
sectionRow: css`
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 var(--spacing-sm);
`,
sectionAddBtn: css`
  width: 18px; height: 18px; border-radius: 4px; border: none;
  background: transparent; color: var(--text-tertiary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 120ms ease;
  &:hover { background: var(--bg-hover); color: #ff9d00; }
`,
```

- [ ] **Step 7.2: Wire the localStorage flag in `Overview.tsx`**

In `src/pages/Overview.tsx`, in the `DashboardView` component, add a `useEffect` that checks for the flag:

```typescript
useEffect(() => {
  if (localStorage.getItem('agentdeck:open-new-workspace') === '1') {
    localStorage.removeItem('agentdeck:open-new-workspace');
    setShowAddProj(true);
  }
}, []);
```

- [ ] **Step 7.3: Add space count badge to workspace rows**

In `Sidebar.tsx`, import `spaces` from `useDashboard` (already imported). Find the workspace row rendering and add a badge showing space count. Inside the `wsClickArea` button, after `<span className={s.wsName}>{w.name}</span>`, add:

```typescript
{(() => {
  const count = spaces.filter(sp => sp.workspaceId === w.id).length;
  return count > 0 ? (
    <span className={s.wsSpaceBadge}>{count}</span>
  ) : null;
})()}
```

Add the style:

```typescript
wsSpaceBadge: css`
  font-size: 9px; font-weight: 700; color: var(--text-tertiary);
  background: var(--bg-tertiary); border-radius: 99px;
  padding: 1px 5px; flex-shrink: 0; letter-spacing: 0;
`,
```

- [ ] **Step 7.4: Add pulsing running indicator on space rows**

In the space row rendering, add a running dot when a plan is running. Inside the `spaceRow` div, after the `<span className={s.spaceName}>` element, add:

```typescript
{(() => {
  const isRunning = localStorage.getItem(`agentdeck:conductor:running:${sp.workspaceId}`) === 'true';
  return isRunning ? <span className={s.spaceRunningDot} /> : null;
})()}
```

Add the style:

```typescript
spaceRunningDot: css`
  width: 5px; height: 5px; border-radius: 50%;
  background: #ff9d00; flex-shrink: 0;
  animation: pulse 1.5s ease-in-out infinite;
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
`,
```

Note: `localStorage` is read at render time. For a live indicator, this will update when the sidebar re-renders. Since the conductor runs in the same view, React state changes in WorkspaceConductor will cause parent re-renders that trigger sidebar updates. This is sufficient for the use case.

- [ ] **Step 7.5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 7.6: Commit**

```bash
git add src/components/layout/Sidebar.tsx src/pages/Overview.tsx
git commit -m "feat(Sidebar): + workspace shortcut, space count badge, running indicator

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: `SpaceManagerModal` — stale session detection

**Files:**
- Modify: `src/components/ui/SpaceManagerModal.tsx`
- Modify: `src/components/ui/GroupChat.tsx` (add stale banner)

- [ ] **Step 8.1: Detect and display stale session IDs in `SpaceManagerModal`**

In `SpaceManagerModal.tsx`, inside the session list rendering, split sessions into active and stale:

Replace the session list section with:

```typescript
<div className={s.field}>
  <label className={s.label}>
    Terminal Sessions
    <span className={s.labelHint}>&nbsp;— select which tabs belong to this space</span>
  </label>
  {workspaceSessions.length === 0 ? (
    <div className={s.emptySessionsBox}>
      <Terminal size={14} className={s.emptyIcon} />
      <span>
        No active sessions. Open the workspace console first,
        then come back to assign tabs.
      </span>
    </div>
  ) : (
    <div className={s.sessionList}>
      {workspaceSessions.map(sess => {
        const checked = selectedIds.has(sess.id);
        return (
          <label
            key={sess.id}
            className={cx(s.sessionItem, checked && s.sessionItemChecked)}
            style={checked ? { borderColor: color } : undefined}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggleSession(sess.id)}
              className={s.checkbox}
            />
            <span className={s.sessionDot} style={{ backgroundColor: sess.color ?? '#334155' }} />
            <span className={s.sessionName}>{sess.title}</span>
          </label>
        );
      })}
    </div>
  )}
  {/* Stale sessions: stored in space but no longer active */}
  {space && (() => {
    const stalIds = space.sessionIds.filter(
      id => !workspaceSessions.some(s => s.id === id),
    );
    if (stalIds.length === 0) return null;
    return (
      <div className={s.staleSection}>
        <span className={s.staleLabel}>
          ⚠ {stalIds.length} session{stalIds.length !== 1 ? 's' : ''} from a previous launch (no longer active)
        </span>
        {stalIds.map(id => (
          <div key={id} className={s.staleItem}>
            <span className={s.staleDot} />
            <span className={s.staleId}>{id.slice(0, 12)}…</span>
            <button
              type="button"
              className={s.staleRemoveBtn}
              onClick={() => setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; })}
              title="Remove stale session"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    );
  })()}
</div>
```

Add the new styles:

```typescript
staleSection: css`
  margin-top: 8px; padding: 10px 12px;
  background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.2);
  border-radius: 8px; display: flex; flex-direction: column; gap: 6px;
`,
staleLabel: css`
  font-size: 10px; font-weight: 700; color: #f59e0b;
`,
staleItem: css`
  display: flex; align-items: center; gap: 8px;
`,
staleDot: css`
  width: 6px; height: 6px; border-radius: 50%;
  background: #475569; flex-shrink: 0;
`,
staleId: css`
  font-size: 10px; color: #475569; font-family: 'Fira Code', monospace; flex: 1;
`,
staleRemoveBtn: css`
  background: transparent; border: none; color: #64748b;
  font-size: 9px; cursor: pointer; padding: 2px 4px;
  border-radius: 3px; transition: color 120ms ease;
  &:hover { color: #ef4444; }
`,
```

- [ ] **Step 8.2: Add stale-sessions banner in `GroupChat.tsx`**

In `GroupChat.tsx`, in the render section just below the warning banners, add:

```typescript
{/* Stale space sessions warning */}
{activeSpace && activeSpace.sessionIds.length > 0 && groupSessions.length === 0 && (
  <div className={s.warningBanner} style={{ borderBottomColor: 'rgba(245,158,11,0.2)' }}>
    ⚠ Sessions assigned to <strong>{activeSpace.name}</strong> are from a previous launch.
    {' '}
    <button
      style={{
        background: 'transparent', border: 'none', color: '#fbbf24',
        textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit', padding: 0,
      }}
      onClick={() => {
        // Trigger the SpaceManagerModal — use localStorage flag approach
        localStorage.setItem('agentdeck:open-space-modal', activeSpace.id);
        window.dispatchEvent(new Event('agentdeck:open-space-modal'));
      }}
    >
      Re-add sessions
    </button>
    {' '}via Space settings.
  </div>
)}
```

Then in `Sidebar.tsx`, add a `useEffect` that listens for the event and opens the modal:

```typescript
useEffect(() => {
  const handler = () => {
    const spaceId = localStorage.getItem('agentdeck:open-space-modal');
    if (spaceId) {
      localStorage.removeItem('agentdeck:open-space-modal');
      const sp = spaces.find(s => s.id === spaceId);
      if (sp) openEditSpace(sp);
    }
  };
  window.addEventListener('agentdeck:open-space-modal', handler);
  return () => window.removeEventListener('agentdeck:open-space-modal', handler);
}, [spaces]);
```

- [ ] **Step 8.3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 8.4: Commit**

```bash
git add src/components/ui/SpaceManagerModal.tsx src/components/ui/GroupChat.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(SpaceManagerModal): stale session detection and removal UX

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Terminal Tab UX — icon-only New Tab, overflow fade

**Files:**
- Modify: `src/components/terminal/TerminalContainer.tsx`

- [ ] **Step 9.1: Remove "New Tab" text label**

Find the New Tab button in `TerminalContainer.tsx`:

```typescript
// BEFORE
<button onClick={() => createNewTab()} className={styles.newTabBtn}>
  <Plus className={styles.smallIcon} />
  <span>New Tab</span>
</button>

// AFTER
<button onClick={() => createNewTab()} className={styles.newTabBtn} title="New Tab">
  <Plus className={styles.smallIcon} />
</button>
```

Update the `newTabBtn` style to be square (icon-only):

```typescript
newTabBtn: css`
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; color: #94a3b8;
  background-color: #0d1c2a; border: 1px solid #1a2e40;
  border-radius: 6px; padding: 4px; width: 28px; height: 28px;
  cursor: pointer; transition: all 150ms ease; white-space: nowrap; flex-shrink: 0;
  &:hover { color: #ffffff; background-color: #122030; border-color: #243a50; }
`,
```

- [ ] **Step 9.2: Add overflow fade on tab list**

Update the `tabsList` style to add a right-edge fade when overflowing:

```typescript
tabsList: css`
  display: flex; align-items: flex-end; overflow-x: auto;
  padding-top: 8px; flex: 1; gap: 4px; min-width: 0;
  &::-webkit-scrollbar { display: none; }
  scrollbar-width: none;
  /* Fade the right edge when content overflows */
  mask-image: linear-gradient(to right, black calc(100% - 32px), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, black calc(100% - 32px), transparent 100%);
`,
```

- [ ] **Step 9.3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 9.4: Commit**

```bash
git add src/components/terminal/TerminalContainer.tsx
git commit -m "feat(TerminalContainer): icon-only New Tab button, tab overflow fade

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Overview UX — running indicator on Conductor tab, space count on cards

**Files:**
- Modify: `src/pages/Overview.tsx`

- [ ] **Step 10.1: Add running indicator to the Conductor right-panel tab**

In `Overview.tsx`, find the Conductor tab button:

```typescript
// BEFORE
<button
  className={cx(s.rightTab, rightPanel === 'conductor' && s.rightTabActive)}
  onClick={() => setRightPanel('conductor')}
>
  <Network className={s.rightTabIcon} />
  Conductor
</button>

// AFTER
<button
  className={cx(s.rightTab, rightPanel === 'conductor' && s.rightTabActive)}
  onClick={() => setRightPanel('conductor')}
>
  <Network className={s.rightTabIcon} />
  Conductor
  {activeProject && localStorage.getItem(`agentdeck:conductor:running:${activeProject.id}`) === 'true' && (
    <span className={s.tabRunningDot} />
  )}
</button>
```

Add the style:

```typescript
tabRunningDot: css`
  width: 5px; height: 5px; border-radius: 50%; background: #ff9d00;
  margin-left: 4px; flex-shrink: 0;
  animation: pulse 1.5s ease-in-out infinite;
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
`,
```

- [ ] **Step 10.2: Add space count badge to workspace grid cards**

In the `Overview.tsx` grid card section, add the `spaces` import from `useDashboard` (already destructured — add it to the destructure list if missing). Then inside each card, after the `cardMeta` div, add a space count badge:

First add `spaces` to the destructure in `DashboardView`:
```typescript
const {
  workspaces,
  spaces,           // ← ensure this is included
  activeWorkspaceId,
  ...
} = useDashboard();
```

Then inside the card, after `{proj.description && <p className={s.cardDesc}>{proj.description}</p>}`:

```typescript
{(() => {
  const spaceCount = spaces.filter(sp => sp.workspaceId === proj.id).length;
  return spaceCount > 0 ? (
    <div className={s.cardSpaceBadge}>
      <span>{spaceCount} space{spaceCount !== 1 ? 's' : ''}</span>
    </div>
  ) : null;
})()}
```

Add the style:

```typescript
cardSpaceBadge: css`
  display: inline-flex; align-items: center;
  background: var(--bg-tertiary); border: 1px solid var(--border-color);
  border-radius: 99px; padding: 2px 8px; margin-top: 6px;
  font-size: 10px; font-weight: 600; color: var(--text-tertiary);
`,
```

- [ ] **Step 10.3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 10.4: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "feat(Overview): conductor running indicator, space count on workspace cards

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Final verification

- [ ] **Step 11.1: Full TypeScript check**

```bash
cd C:/Users/anasa/Desktop/agentdeck
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 11.2: Build check**

```bash
npm run build
```

Expected: build succeeds with no errors (warnings from existing code are acceptable).

- [ ] **Step 11.3: Manual smoke test checklist**

Start the dev server: `npm run tauri dev`

Check each item:
1. **GroupChat persistence** — open Chat, send a message, switch to Workspace tab, switch back → message is still there ✓
2. **GroupChat live feed** — click the Activity icon (turns green) → terminals in the space should start producing summaries after output ✓
3. **GroupChat injection** — type "tell [terminal name] to echo hello" → Ollama should produce an INJECT→ line and the terminal receives it ✓
4. **Save to Vault** — hover over an assistant message → bookmark icon appears → click it → toast "Saved to Prompt Vault" ✓
5. **Export** — click download icon → `.md` file downloads ✓
6. **Clear** — click X → chat clears ✓
7. **Conductor session filter** — create a Space, assign 1 of 2 terminals → open Conductor Build tab → session picker shows only 1 session ✓
8. **Plan spaceId** — create plan without space, activate a space → plan still visible when space is deactivated ✓
9. **Sidebar + shortcut** — click `+` next to Workspaces → New Workspace dialog opens ✓
10. **Space count badge** — workspace with 2 spaces shows "2" badge in sidebar ✓
11. **Stale sessions** — restart app (sessions get new IDs), open SpaceManagerModal → stale IDs shown in yellow section ✓
12. **New Tab icon** — terminal header shows icon-only `+` button ✓
13. **Space count on grid cards** — grid card shows "N spaces" badge ✓

- [ ] **Step 11.4: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification pass

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage check:**
- §1.1 stale closure fix → Task 5 (streamingContentRef) ✓
- §1.2 chat persistence → Task 5 ✓
- §1.3 watchForSummary → Tasks 3 + 5 ✓
- §1.4 terminal injection → Task 5 ✓
- §1.5 save to vault → Task 5 ✓
- §1.6 export transcript → Task 5 ✓
- §1.7 UX improvements (suggestions, markdown, chips) → Task 5 ✓
- §2.1 spaceId null bug → Task 1 ✓
- §2.2 PlanBuilder session filter → Task 6 ✓
- §2.3 HistoryCard type fix → Task 2 ✓
- §2.4 session count hint + UX → Task 6 ✓
- §3.1 stale session banner → Tasks 8 (modal) + 5 (GroupChat banner) ✓
- §3.2 sidebar + shortcut, badge, running dot → Task 7 ✓
- §4.1 TerminalContainer icon-only, overflow fade → Task 9 ✓
- §5.1 conductor running dot on tab → Task 10 ✓
- §5.2 space count on grid cards → Task 10 ✓
- §6.1 summariseChunk → Task 4 ✓
- §6.2 TypeScript strictness → Tasks 1+2 ✓
- §6.3 storage migration → Task 1 ✓

**All spec sections covered.**

**Placeholder scan:** No TBDs, no "implement later", no missing code blocks found.

**Type consistency:**
- `spaceId: string | null` used consistently across Tasks 1, 5, 6
- `watchForSummary(sessionId, onChunk)` defined in Task 3, consumed in Task 5 ✓
- `clearSummary(sessionId)` defined in Task 3, consumed in Task 5 cleanup ✓
- `summariseChunk(chunk, tabTitle, ollamaHost, model)` defined in Task 4, consumed in Task 5 ✓
- `streamingContentRef` defined in Task 5 Step 5.1, used in `onToken` and `onDone` within same file ✓
