# Orchaterm — Architecture & Implementation Guide (v2)

> **The problem solved:** You run multiple AI agents (Claude Code, Antigravity, Hermes, etc.) in separate terminals. They are completely isolated — they can't see each other's work, share context, or hand off to each other. You end up manually copy-pasting between windows, acting as the messenger. Orchaterm eliminates that role by becoming the coordination layer: Ollama watches all your agent terminals, summarises their output, routes context between them, and lets you watch the whole team work from a single chat-style view.

---

## Table of Contents

1. [Revised Vision](#1-revised-vision)
2. [What Orchaterm Is NOT](#2-what-orchaterm-is-not)
3. [Core Architecture](#3-core-architecture)
4. [The Three Panels Explained](#4-the-three-panels-explained)
5. [Agent Groups](#5-agent-groups)
6. [The Chat Panel](#6-the-chat-panel)
7. [The Conductor Panel](#7-the-conductor-panel)
8. [PTY Layer (unchanged)](#8-pty-layer-unchanged)
9. [Sentinel Protocol (unchanged)](#9-sentinel-protocol-unchanged)
10. [Ollama's Role](#10-ollamas-role)
11. [Data Models](#11-data-models)
12. [Services](#12-services)
13. [Implementation Roadmap](#13-implementation-roadmap)
14. [What Changes vs v1](#14-what-changes-vs-v1)

---

## 1. Revised Vision

### The correct mental model

```
Workspace terminals  =  your dev processes
                         (npm run dev, go run ., git pull, etc.)
                         You interact with these directly.
                         Nothing special about them.

Agent terminals      =  terminals where you happen to be running AI agents
                         (claude, antigravity, hermes, etc.)
                         ALSO just normal terminals.
                         You interact with agents through their own CLI.
                         No features lost.

Agent Group          =  you tell Orchaterm "these terminals are my agents"
                         by grouping them together.
                         From that point, Ollama watches them and
                         coordinates between them.

Chat panel           =  your window into Ollama's orchestration.
                         See what each agent is doing (as short summaries).
                         Talk to Ollama — it relays your instructions to agents.
                         Watch agents hand off to each other.

Conductor panel      =  structured task planning.
                         Define a goal, break it into tasks, assign tasks
                         to terminals in the group, run the plan.
                         Ollama dispatches and relays automatically.
```

### Your workflow with Orchaterm

```
1. Open terminals for your dev processes (npm run dev, etc.)
2. Open more terminals, run your agents in them (claude, antigravity…)
3. Create an Agent Group — add the agent terminals to it. Give it a name.
4. In the Chat panel: watch Ollama summarise what each agent is doing.
   Ask Ollama things. It relays your instructions to the right agent terminal.
5. In the Conductor panel (optional): define a structured task plan.
   Hit Run. Ollama dispatches tasks to the right terminals automatically.
   Watch the pipeline board. Intervene when you want.
```

---

## 2. What Orchaterm Is NOT

- ❌ Orchaterm does not replace your agent's CLI (you still use Claude Code's slash commands, file references, etc. directly in the terminal)
- ❌ Orchaterm does not require you to register agent profiles before use
- ❌ Orchaterm does not have a custom chat interface for talking to agents directly
- ❌ Ollama does not plan features, write code, or make architecture decisions
- ❌ The Agents page no longer exists — it is removed

---

## 3. Core Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Orchaterm App (Tauri)                             │
│                                                                              │
│  ┌──────────────┐    ┌────────────────────────────────────────────────────┐  │
│  │   Sidebar    │    │              Main Content Area                     │  │
│  │              │    │                                                    │  │
│  │  Workspaces  │    │  ┌──────────────────┐  ┌────────────────────────┐  │  │
│  │  └─ WS 1     │    │  │   Left Panel     │  │    Right Panel         │  │  │
│  │     └ Group A│───▶│  │                  │  │  [Workspace][Conductor]│  │  │
│  │     └ Group B│    │  │   Terminal tabs  │  │  [Chat]                │  │  │
│  │  └─ WS 2     │    │  │   (all equal —   │  │                        │  │  │
│  │              │    │  │   dev + agents   │  │  Active panel scoped   │  │  │
│  │  Navigation  │    │  │   mixed freely)  │  │  to selected Group     │  │  │
│  │  - Overview  │    │  │                  │  │                        │  │  │
│  │  - Task Log  │    │  │  Colors, rename, │  │                        │  │  │
│  │  - Prompts   │    │  │  drag to reorder │  │                        │  │  │
│  │  - Settings  │    │  └──────────────────┘  └────────────────────────┘  │  │
│  └──────────────┘    └────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                    Orchestration Layer (JS services)                 │    │
│  │                                                                      │    │
│  │   BufferWatcher   │   OrchestratorEngine   │   OllamaRelay           │    │
│  │   (reads PTY)     │   (task dispatcher)    │   (summarise + route)   │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                      PTY Layer (Rust backend)                        │    │
│  │   spawn_pty  │  write_pty  │  resize_pty  │  kill_pty                │    │
│  │   pty-data-{sessionId} events                                        │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                             ┌──────▼──────┐
                             │Ollama (local)│
                             │  small LLM  │
                             │ orchestrator│
                             └─────────────┘
```

---

## 4. The Three Panels Explained

### Left panel — Terminals

All terminal tabs live here. Dev terminals, agent terminals — no distinction in the UI. The user decides what runs in each tab.

**Tab features:**
- **Rename** — double-click tab label to rename
- **Color** — assign a colour to any tab (helps visually distinguish claude tab from npm dev tab)
- **Drag to reorder** — drag tabs to rearrange their order
- **Multi-tab** — open as many as needed

### Right panel — Three tabs

The right panel is scoped to the **active Agent Group** (selected from the sidebar). If no group is selected, only the Workspace tab is shown.

| Tab | Purpose |
|-----|---------|
| `[Workspace]` | Project info, description, path. Always available. |
| `[Conductor]` | Task planning + pipeline board. Scoped to active group. |
| `[Chat]` | Ollama orchestration feed + your input to Ollama. Scoped to active group. |

---

## 5. Agent Groups

An Agent Group is the core organising unit for orchestration. It answers: **"which terminals are my agents for this task?"**

### How it works

1. You open terminals and run your agents in some of them
2. You create a Group (e.g. "Frontend Sprint") under the current workspace
3. You add terminal tabs to the group — the ones where you're running agents
4. That group now has its own Chat thread and Conductor plan
5. Ollama watches only the terminals in that group

### Multiple groups per workspace

You can have multiple groups in one workspace, each isolated:

```
Workspace: MyProject
├── Group: "Frontend Team"   → Terminal 2 (claude), Terminal 4 (hermes)
└── Group: "API Refactor"    → Terminal 3 (antigravity), Terminal 5 (claude)
```

The groups do not share context. Ollama orchestrates each group independently.

### Groups in the sidebar

Groups appear in the sidebar under their workspace, nested below it:

```
Workspaces
  └─ MyProject                  ← workspace (clicking opens console view)
       ├─ 🟠 Frontend Team      ← group (clicking opens this group's Chat+Conductor)
       └─ 🔵 API Refactor       ← group
```

Clicking a group:
- Switches the workspace console view to active
- Sets the right panel to show that group's Chat and Conductor tabs

### Creating and managing groups

- **Create**: "+" button in the sidebar below the workspace, or from the right panel
- **Name**: free text — "Auth Sprint", "Week 3 Backend", anything
- **Add terminals**: dropdown showing all open terminal tabs for this workspace; tick the ones running agents
- **Remove terminals**: untick from the same dropdown
- **Delete group**: removes the group and its plan/chat history; does NOT close terminal tabs

### Groups and the Conductor

Each group has exactly **one active Conductor plan**. The plan's tasks are assigned to terminals within the group. When you create a new plan inside a group's Conductor tab, the session picker only shows terminals that are members of that group.

---

## 6. The Chat Panel

The Chat panel is your window into Ollama's orchestration of a group. It shows what's happening across all agent terminals in the group, surfaces Ollama's relay actions, and lets you talk to Ollama.

### What appears in the Chat feed

| Message type | Sender | What it shows |
|---|---|---|
| Agent summary | Agent name + colour | Short summary of what the agent just output (Ollama condenses raw terminal output) |
| Ollama relay | Ollama | "Relayed Claude's output to Antigravity: [brief excerpt]" |
| Task dispatch | Conductor | "Dispatched task-2 to Terminal 3 (Antigravity)" |
| Task complete | Conductor | "Task-2 complete ✓ — Auth middleware written" |
| Your message | You | What you typed to Ollama |
| Ollama response | Ollama | Ollama's reply to your question or instruction |
| Injected message | You → Agent | "Sent to Terminal 2 (Claude): [message]" |

### The only input in the Chat talks to Ollama

You do not have separate inputs per agent. You talk to Ollama. Ollama handles routing.

Examples of what you can say:
- *"What is everyone working on right now?"* → Ollama reads all buffers and summarises
- *"Tell claude to switch to Postgres instead of SQLite"* → Ollama crafts the message, injects it into that terminal via `write_pty`
- *"Improve this prompt: [text]"* → Ollama returns an improved version with Copy and Send options
- *"@terminal-2 stop and focus on the auth bug"* → Ollama routes the instruction to Terminal 2
- *"Summarise what antigravity has done so far"* → Ollama reads that terminal's buffer and replies

### How Ollama knows what to inject

When you say "tell X to do Y", Ollama:
1. Identifies the target terminal from your message (by name, tab title, or @terminal-N)
2. Crafts an appropriate message for that agent
3. Calls `write_pty(sessionId, message + '\n')` on that terminal
4. Posts a confirmation in the Chat feed: "Sent to Terminal 2: [message]"

The user always sees what was injected — full transparency.

### Prompt improvement flow

When you ask Ollama to improve a prompt:
```
You:    "Improve this: build a JWT auth system with refresh tokens"
Ollama: Here is an improved version:
        ─────────────────────────────
        Build a JWT authentication system with the following requirements:
        - Access tokens: 15-minute expiry, RS256 signing
        - Refresh tokens: 7-day expiry, stored in httpOnly cookie
        - Endpoints: POST /auth/login, POST /auth/refresh, POST /auth/logout
        - Middleware: validateToken() that extracts userId from claims
        - Tests: unit tests for token generation, integration tests for all endpoints
        ─────────────────────────────
        [Copy]  [Send to Terminal 2 ▾]  [Edit & Send]
```

### Ollama offline behaviour

If Ollama is not running, the Chat panel shows an offline banner. The Conductor still functions in pass-through relay mode (uses sentinel fields directly). The Chat feed shows raw terminal summaries without Ollama condensing them.

---

## 7. The Conductor Panel

The Conductor is the structured task execution layer. It lives in the right panel's `[Conductor]` tab and is scoped to the active Agent Group.

### Core flow (unchanged from v1)

1. User enters an overall goal
2. A task plan is created (manually, or by asking a capable agent to generate it)
3. Each task is assigned to a terminal tab that's a member of the current group
4. User approves the plan
5. User hits Run
6. OrchestratorEngine dispatches tasks via `write_pty`, one task per terminal at a time
7. BufferWatcher monitors agent terminal output for the sentinel token
8. When sentinel is detected: task marked done, Ollama relays context to the next task's terminal
9. Pipeline board updates in real time
10. Plan completes when all tasks are done

### Session picker (updated)

The plan builder's session picker now shows **terminals in the current group** only. No agent catalog — just tab titles like "PowerShell 1", "Terminal 2 (claude)", etc., whatever the user has named them.

### Sentinel Protocol (unchanged)

Every dispatched task ends with the instruction to output the sentinel:

```
###ORCHATERM_DONE###
task_id: {id}
summary: {what was done}
files_modified: {files or "none"}
needs: {what next agent needs or "none"}
###ORCHATERM_END###
```

The BufferWatcher detects this, OrchestratorEngine marks the task done, OllamaRelay crafts the brief for the next task.

---

## 8. PTY Layer (unchanged)

The Rust PTY backend requires **zero changes**. All commands work as before.

| Command | Purpose |
|---|---|
| `spawn_pty(sessionId, path, cols, rows, shell, shellArgs)` | Spawn a shell process |
| `write_pty(sessionId, data)` | Inject text into a running terminal. Always append `\n`. |
| `resize_pty(sessionId, cols, rows)` | Resize the terminal |
| `kill_pty(sessionId)` | Kill the shell process |
| `get_available_shells()` | List available shells on the OS |

Terminal output flows via `pty-data-{sessionId}` Tauri events. Both `TerminalTab` (display) and `BufferWatcher` (accumulation) listen to the same events simultaneously.

---

## 9. Sentinel Protocol (unchanged)

Same as v1. The orchestrator appends the sentinel instruction to every dispatched task prompt. Agents output the sentinel block when they complete the task. BufferWatcher detects it, parses it, and triggers the next step.

```typescript
const SENTINEL_START = '###ORCHATERM_DONE###';
const SENTINEL_END   = '###ORCHATERM_END###';
const PLAN_START     = '###ORCHATERM_PLAN_START###';
const PLAN_END       = '###ORCHATERM_PLAN_END###';
```

ANSI stripping is applied before any Ollama processing.

---

## 10. Ollama's Role

Ollama runs a small local model and performs these tasks only:

| Task | Context |
|---|---|
| **Summarise agent output** | Condense raw terminal output into 1-3 readable sentences for the Chat feed |
| **Relay context** | Reformat a completed task's output into a clear brief for the next task's agent |
| **Answer your questions** | "What are they doing?", "Summarise what X has done so far" |
| **Route your instructions** | Parse "@terminal-2 do X", craft the message, inject it |
| **Improve prompts** | Rewrite a rough prompt into a detailed, actionable instruction |
| **Merge parallel outputs** | When multiple tasks all feed into one next task, synthesise their outputs into a single brief |

Ollama does NOT plan features, write code, or make architectural decisions.

### Why local Ollama

- No cost — orchestration calls are frequent
- No latency from internet
- Privacy — agent outputs often contain proprietary code
- No rate limits

### Offline fallback

- Conductor: pass-through relay using sentinel `summary` + `needs` fields directly
- Chat: shows raw terminal output without summarisation, offline banner displayed

---

## 11. Data Models

### Updated: `TerminalSession`

```typescript
export interface TerminalSession {
  id: string;
  title: string;
  shell: string;
  shellArgs: string[];
  workspaceId: string;
  /** Display colour for the tab. Hex string e.g. '#3b82f6'. null = default. */
  color: string | null;
  /** Display order within the tab bar. Lower = leftmost. */
  order: number;
  // NOTE: assignedAgentId is removed. Group membership replaces it.
}
```

### New: `AgentGroup`

```typescript
export interface AgentGroup {
  id: string;
  name: string;
  workspaceId: string;
  /** Hex colour for the group indicator dot in the sidebar. */
  color: string;
  /** IDs of TerminalSession tabs that are members of this group.
   *  Terminals can only belong to one group at a time.
   *  Session IDs are ephemeral — they reset on app relaunch. 
   *  The user re-adds tabs to the group each session (takes seconds). */
  sessionIds: string[];
  createdAt: number;
}
```

### New: `ChatMessage`

```typescript
export type ChatMessageSender =
  | { type: 'user' }
  | { type: 'ollama' }
  | { type: 'agent-summary'; sessionId: string; tabTitle: string }
  | { type: 'conductor'; event: 'dispatch' | 'complete' | 'failed' | 'relay' };

export interface ChatMessage {
  id: string;
  groupId: string;
  sender: ChatMessageSender;
  content: string;
  timestamp: number;
  /** For agent-summary messages: the raw terminal chunk that was summarised. */
  rawChunk?: string;
  /** For prompt-improvement responses: the improved prompt text. */
  improvedPrompt?: string;
  /** For injected messages: the sessionId that was written to. */
  injectedSessionId?: string;
}
```

### Updated: `OrchestratorPlan`

```typescript
export interface OrchestratorPlan {
  id: string;
  goal: string;
  tasks: OrchestratorTask[];
  status: OrchestratorPlanStatus;
  createdAt: number;
  completedAt?: number;
  workspaceId: string;
  /** Scopes the plan to a specific Agent Group. */
  groupId: string;
}
```

### Updated: `OrchestratorTask`

```typescript
export interface OrchestratorTask {
  id: string;
  title: string;
  description: string;
  /** PTY session ID. Must be a member of the plan's group. */
  assignedSessionId: string;
  /** Tab title at time of assignment — for display only. */
  assignedSessionTitle: string;
  dependsOn: string[];
  status: OrchestratorTaskStatus;
  startedAt?: number;
  completedAt?: number;
  output?: OrchestratorTaskOutput;
  // NOTE: assignedAgentId is removed.
}
```

### Removed types

- `Agent` — removed entirely. No agent catalog.
- `SessionRegistryEntry` — removed. Replaced by AgentGroup membership.

### Cleaned up: `Workspace`

```typescript
export interface Workspace {
  id: string;
  name: string;
  path: string;
  description: string;
  color: string;
  status: 'active' | 'paused' | 'idle';
  currentTask: string;
  // NOTE: agentId removed — no longer assigns a single agent to a workspace.
  createdAt: string;
  updatedAt: string;
}
```

### Updated: `AppData`

```typescript
export interface AppData {
  workspaces: Workspace[];
  agentGroups: AgentGroup[];  // replaces agents[]
  taskLogs: TaskLog[];
  savedPrompts: SavedPrompt[];
  settings?: AppSettings;
}
```

### Updated: `TaskLog` and `SavedPrompt`

```typescript
// agentId replaced with groupId (optional, nullable)
export interface TaskLog {
  id: string;
  workspaceId: string;
  groupId: string | null;
  summary: string;
  timestamp: string;
  status: 'in-progress' | 'done' | 'blocked';
}

export interface SavedPrompt {
  id: string;
  workspaceId: string;
  groupId: string | null;  // replaces agentId
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  usedAt: string | null;
}
```

---

## 12. Services

All services live in `src/services/`. The three core orchestration services are largely unchanged from v1 — only their inputs change slightly (no `agentId` references).

### `bufferWatcher.ts` (unchanged logic)

Subscribes to `pty-data-{sessionId}` events for sessions in the active group. Two modes per session: `sentinel` (during task execution) and `plan` (during plan generation from capable agent). Also fires summarisation callbacks for the Chat feed.

```typescript
interface BufferWatcher {
  watchForSentinel(sessionId: string, onSentinel: (output: OrchestratorTaskOutput) => void): void;
  watchForPlan(sessionId: string, onPlan: (rawJson: string) => void, onError: (err: string) => void): void;
  watchForSummary(sessionId: string, onChunk: (chunk: string) => void): void; // NEW — feeds Chat panel
  clearBuffer(sessionId: string): void;
  unwatch(sessionId: string): void;
  getBuffer(sessionId: string): string;
}
```

### `sentinelParser.ts` (unchanged)

```typescript
function parseSentinel(buffer: string): OrchestratorTaskOutput | null
function stripAnsiCodes(text: string): string
function extractField(block: string, field: string): string
```

### `orchestratorEngine.ts` (minor update)

`assignedAgentId` references removed from dispatch. Session title used for display instead.

### `ollamaRelay.ts` (extended for Chat)

New functions added alongside existing relay functions:

```typescript
// Existing — used by Conductor for task-to-task relay
async function relayViaOllama(input: OllamaRelayInput): Promise<string>

// New — used by Chat panel to summarise terminal output
async function summariseChunk(chunk: string, tabTitle: string, ollamaHost: string, model: string): Promise<string>

// New — used when user asks Ollama a question in Chat
async function chatWithOllama(
  userMessage: string,
  groupContext: { tabTitle: string; recentSummary: string }[],
  ollamaHost: string,
  model: string
): Promise<OllamaChatResponse>

export interface OllamaChatResponse {
  reply: string;
  /** If the reply includes an inject instruction, this is populated. */
  inject?: { sessionId: string; message: string };
  /** If the reply includes an improved prompt, this is populated. */
  improvedPrompt?: string;
}
```

---

## 13. Implementation Roadmap

### Phase 1 — Remove dead code

1. Delete `src/pages/Agents.tsx`
2. Remove `/agents` route from `src/routes/AppRoutes.tsx`
3. Remove "Agents" nav item from `src/components/layout/Sidebar.tsx`
4. Remove `Agent` type and `agentId` fields from `workspace.types.ts`
5. Remove `SessionRegistryEntry` from `terminal.types.ts`, remove `assignedAgentId` from `TerminalSession`
6. Remove `assignedAgentId` from `OrchestratorTask` in `conductor.types.ts`
7. Remove all `agents` state, `addAgent`/`updateAgent`/`deleteAgent`/`launchAgent` from `DashboardContext`
8. Clean up `AppData` type — replace `agents: Agent[]` with `agentGroups: AgentGroup[]`

### Phase 2 — Terminal tab enhancements

9. Add `color: string | null` and `order: number` to `TerminalSession` type
10. Add colour picker to terminal tabs (right-click menu or settings icon on tab)
11. Add drag-to-reorder using HTML5 drag-and-drop on the tab strip
12. Persist `color` and `order` via `updateTerminalSession` to context

### Phase 3 — Agent Groups

13. Add `AgentGroup` type to `src/types/group.types.ts`
14. Add `agentGroups` state + CRUD to `DashboardContext`
15. Add group persistence to `src/services/storage.ts` (stored in `orchaterm_data.json` alongside workspaces)
16. Add group list to sidebar under each workspace (collapsible, with "+" to create new group)
17. Build group management UI: name, color, add/remove terminal sessions
18. Add `activeGroupId` state to `DashboardContext`
19. Wire right panel: when a group is selected, show Conductor + Chat tabs

### Phase 4 — Conductor scoped to group

20. Update plan builder session picker to show only sessions in the active group
21. Update `OrchestratorPlan` to include `groupId`
22. Update `WorkspaceConductor` to scope plans by `groupId` instead of `workspaceId`
23. Remove `SessionRegistry` component (replaced by group membership)

### Phase 5 — Chat panel (core)

24. Build `src/components/chat/GroupChat.tsx` — the chat feed component
25. Build `ChatMessage` rendering (different styles per sender type)
26. Wire `BufferWatcher.watchForSummary` to trigger `ollamaRelay.summariseChunk` and post to Chat feed
27. Build the Ollama input bar at the bottom of the Chat panel
28. Wire input → `ollamaRelay.chatWithOllama` → render response in Chat
29. Handle inject responses: call `write_pty` and post confirmation message in Chat
30. Handle prompt improvement responses: show Copy + Send buttons

### Phase 6 — Polish

31. Ollama status indicator in Chat panel header (online/offline)
32. Chat history persistence per group (store last N messages in localStorage)
33. Tab colour displayed in Chat feed agent-summary messages (coloured dot matching tab colour)
34. "Add to Prompt Vault" button on any Chat message
35. Keyboard shortcut to jump from terminal tab to its group's Chat panel
36. Group colour customisation
37. Export Chat transcript

---

## 14. What Changes vs v1

| v1 | v2 |
|---|---|
| Agents page (register agent profiles) | **Removed** |
| Session Registry (assign agent profile to terminal) | **Replaced by Agent Groups** |
| `Agent` type | **Removed** |
| `assignedAgentId` on TerminalSession and OrchestratorTask | **Removed** |
| Conductor's session picker showed agent profiles | **Now shows terminal tab titles directly** |
| Chat with agents directly | **Not a feature — use agent's own terminal CLI** |
| Custom per-agent input | **Not a feature — one Ollama input in Chat** |
| `Workspace.agentId` | **Removed** |
| `SessionRegistryEntry` type | **Removed** |
| Terminal tabs: rename only | **Rename + colour + drag to reorder** |
| Conductor scoped to workspace | **Conductor scoped to Agent Group** |
| No Chat panel | **New Chat panel with Ollama orchestration feed** |
| Ollama only used for task relay | **Ollama also summarises output, answers questions, routes injections** |

---

## Summary

Orchaterm's revised architecture keeps everything that works — the PTY layer, sentinel protocol, Ollama relay, dependency engine — while correcting the fundamental model: **you interact with agents through their native CLIs, not through Orchaterm's UI**. Orchaterm's job is to watch, coordinate, and give you Ollama as a team lead you can talk to. Groups replace agent profiles as the organising unit. The Chat panel gives you a real-time view of the whole team without ever leaving your workflow.
