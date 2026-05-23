# AgentDeck — Full Architecture & Implementation Guide

> **The problem solved:** When you run multiple AI coding agents (Claude Code, Antigravity, Hermes, etc.) in separate terminals, they are completely isolated. They cannot see each other's output, share context, or coordinate on a task. You end up manually copy-pasting between windows, acting as the messenger. AgentDeck eliminates that role by becoming the coordination layer between all running agents.

---

## Table of Contents

1. [What AgentDeck Is](#1-what-agentdeck-is)
2. [Current State of the App](#2-current-state-of-the-app)
3. [Target Architecture Overview](#3-target-architecture-overview)
4. [Core Concept: The PTY Layer](#4-core-concept-the-pty-layer)
5. [Core Concept: The Sentinel Protocol](#5-core-concept-the-sentinel-protocol)
6. [Core Concept: Ollama as Traffic Controller](#6-core-concept-ollama-as-traffic-controller)
7. [Core Concept: The Task Graph & Dependency Engine](#7-core-concept-the-task-graph--dependency-engine)
8. [Core Concept: How Plans Are Created](#8-core-concept-how-plans-are-created)
9. [Full Orchestration Flow — Step by Step](#9-full-orchestration-flow--step-by-step)
10. [Parallel vs Sequential Execution](#10-parallel-vs-sequential-execution)
11. [Data Models](#11-data-models)
12. [New Services to Build](#12-new-services-to-build)
13. [New UI Components to Build](#13-new-ui-components-to-build)
14. [Ollama Relay Prompt Templates](#14-ollama-relay-prompt-templates)
15. [Agent Setup — CLAUDE.md Protocol](#15-agent-setup--claudemd-protocol)
16. [What Changes in Existing Code](#16-what-changes-in-existing-code)
17. [Implementation Roadmap](#17-implementation-roadmap)

---

## 1. What AgentDeck Is

AgentDeck is a **multi-agent orchestration hub** built as a native desktop app (Tauri + React). Its job is to let N number of AI coding agents — running in real terminal sessions inside the app — work together on a shared goal, with coordination handled automatically.

### The user's workflow without AgentDeck

```
You open Claude Code in terminal 1.
You open Antigravity in terminal 2.
You manually copy Claude Code's output.
You paste it into Antigravity with some context.
You wait. You copy Antigravity's response.
You paste it back. Repeat indefinitely.
```

### The user's workflow with AgentDeck

```
You define a goal and a task plan.
You hit Run.
AgentDeck dispatches tasks to the right agents automatically.
Agents signal when done using a sentinel token.
AgentDeck relays context between agents via Ollama.
You watch a live pipeline board. You intervene only when you want to.
```

---

## 2. Current State of the App

### What is already built and working

| Component | File(s) | Status |
|---|---|---|
| PTY backend (Rust) | `src-tauri/src/lib.rs` | ✅ Complete |
| Terminal tabs (xterm.js) | `src/components/TerminalTab.tsx` | ✅ Complete |
| Multi-tab terminal container | `src/components/TerminalContainer.tsx` | ✅ Complete |
| Agent Registry (CRUD) | `src/components/AgentsView.tsx` | ✅ Complete |
| Workspace management | `src/components/DashboardView.tsx` | ✅ Complete |
| Task Logs | `src/components/TaskLogView.tsx` | ✅ Complete |
| Prompt Vault | `src/components/PromptVaultView.tsx` | ✅ Complete |
| Settings (Ollama host, API keys, shell) | `src/components/SettingsView.tsx` | ✅ Complete |
| Global state & persistence | `src/context/DashboardContext.tsx` | ✅ Complete |
| Tauri FS + localStorage storage | `src/services/storage.ts` | ✅ Complete |
| Data types | `src/types/index.ts` | ✅ Complete |

### What exists but needs to be replaced/repositioned

| Component | File | Problem |
|---|---|---|
| Agent Sandbox | `src/components/AgentSandbox.tsx` | Calls a cloud LLM to roleplay as agents. Completely disconnected from real terminal sessions. Should be renamed "Simulation Mode" and treated as a separate brainstorming/prototyping tool, not the actual orchestration feature. |

### What does not exist yet

- Buffer watcher (accumulating PTY output per session)
- Sentinel parser (detecting and parsing `###AGENTDECK_DONE###`)
- Dependency engine (task graph + dispatcher)
- Ollama relay service (reformatting and routing between agents)
- Conductor UI (the main orchestration interface)
- Pipeline board (visual N-lane task progress)
- Plan builder (creating and editing task plans)

---

## 3. Target Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            AgentDeck App (Tauri)                            │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Conductor UI                                  │  │
│  │  Goal input │ Plan Builder │ Pipeline Board │ Ollama log │ Controls   │  │
│  └──────────────────────────────┬────────────────────────────────────────┘  │
│                                 │                                           │
│  ┌──────────────────────────────▼────────────────────────────────────────┐  │
│  │                      Orchestration Engine (JS)                        │  │
│  │                                                                       │  │
│  │   ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────┐  │  │
│  │   │  Buffer Watcher  │   │ Dependency Engine │   │  Ollama Relay   │  │  │
│  │   │                 │   │                  │   │                  │  │  │
│  │   │ - listens to    │   │ - task graph     │   │ - strips noise   │  │  │
│  │   │   pty-data-*    │   │ - state machine  │   │ - reformats      │  │  │
│  │   │ - accumulates   │──▶│ - dispatcher     │──▶│ - crafts brief   │  │  │
│  │   │   per session   │   │ - unblock check  │   │ - merges parallel│  │  │
│  │   │ - detects       │   │                  │   │   outputs        │  │  │
│  │   │   sentinel      │   └──────────────────┘   └────────┬─────────┘  │  │
│  │   └─────────────────┘                                   │            │  │
│  └─────────────────────────────────────────────────────────┼────────────┘  │
│                                                             │               │
│  ┌──────────────────────────────────────────────────────────▼────────────┐  │
│  │                         PTY Layer (Rust backend)                      │  │
│  │                                                                       │  │
│  │   spawn_pty  │  write_pty  │  resize_pty  │  kill_pty                │  │
│  │   pty-data-{sessionId} events                                        │  │
│  └───────┬──────────────┬──────────────┬──────────────┬─────────────────┘  │
│          │              │              │              │                     │
│  ┌───────▼──┐   ┌───────▼──┐   ┌──────▼───┐   ┌─────▼────┐               │
│  │ Session 1│   │ Session 2│   │ Session 3│   │Session N │               │
│  │          │   │          │   │          │   │          │               │
│  │Claude Code│  │Antigravity│  │  Hermes  │   │  Any CLI │               │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                               ┌──────▼──────┐
                               │Ollama (local)│
                               │  small LLM  │
                               │ relay only  │
                               └─────────────┘
```

---

## 4. Core Concept: The PTY Layer

The PTY (pseudoterminal) layer is the **foundation everything else builds on**. It is already fully implemented in Rust (`src-tauri/src/lib.rs`) and works as follows:

### Available Tauri commands

| Command | What it does |
|---|---|
| `spawn_pty(sessionId, workspacePath, cols, rows, shell, shellArgs)` | Spawns a real shell process (PowerShell, bash, cmd, WSL) in a PTY. Each call creates an independent process. |
| `write_pty(sessionId, data)` | Writes a string into the stdin of a running PTY session. This is how we inject messages into agents. |
| `resize_pty(sessionId, cols, rows)` | Resizes the terminal window. Called by the xterm.js ResizeObserver. |
| `kill_pty(sessionId)` | Kills the shell process and cleans up the session. |
| `get_available_shells()` | Returns available shells detected on the OS (PowerShell, bash, WSL, cmd, Git Bash). |

### How output flows from a running agent to the frontend

1. Agent (e.g. Claude Code) writes output to stdout
2. Rust reader thread picks it up in an 8192-byte buffer
3. Rust emits a Tauri event: `pty-data-{sessionId}` with `{ session_id, data: String }`
4. Frontend listens with `listen("pty-data-{sessionId}", handler)`
5. `TerminalTab.tsx` receives it and calls `term.write(payload.data)` to display it

### Key insight for the orchestrator

The same `pty-data-{sessionId}` events that `TerminalTab` uses to display output **can also be listened to by the Buffer Watcher** simultaneously. The Buffer Watcher accumulates these events into a text buffer per session and watches for the sentinel token. Zero changes needed to the Rust backend.

### Critical implementation detail: `write_pty` requires a newline

When injecting any text into a terminal session via `write_pty`, you **must append `\n`** at the end of the string. Without it, the text appears at the shell prompt but the agent never receives it — it is waiting for the user to press Enter. Every dispatch call must look like:

```typescript
invoke('write_pty', { sessionId, data: dispatchPrompt + '\n' });
```

This applies to every `write_pty` call in the system: task dispatches, Ollama relayed briefs, and manual user injections.

### Session state sharing between TerminalContainer and Conductor

`TerminalContainer.tsx` currently manages its own local session list (`useState<TerminalSession[]>`). The Conductor needs to call `write_pty` on those same sessions. To bridge this, terminal sessions must be **lifted to `DashboardContext`** so both components can read and write them:

- `DashboardContext` gains a `terminalSessions: TerminalSession[]` state and a `activeSessionId: string | null` per workspace
- `TerminalContainer` reads sessions from context instead of local state
- `ConductorView` reads the same sessions list to populate the plan builder's session picker and to dispatch tasks

---

## 5. Core Concept: The Sentinel Protocol

The sentinel protocol is the mechanism by which agents **signal completion** to AgentDeck. Since every AI coding agent (Claude Code, Antigravity, Hermes, etc.) is an LLM at its core, they reliably follow instructions included in their prompt.

### The sentinel token

The orchestrator appends the following instruction to **every task it dispatches** to an agent:

```
When you have fully completed this task — and only when fully complete — 
output the following block exactly as shown, on its own lines, with no 
other text on the same lines:

###AGENTDECK_DONE###
task_id: {THE_TASK_ID_FROM_YOUR_INSTRUCTIONS}
summary: {2–3 sentences describing what you did}
files_modified: {comma-separated list of files you created or changed, or "none"}
needs: {what the next agent or step requires, or "none"}
###AGENTDECK_END###

Do not output this signal until the task is fully complete.
```

### What the Buffer Watcher looks for

The Buffer Watcher scans every new chunk of `pty-data-*` output for the pattern:

```
###AGENTDECK_DONE###
```

When found, it reads forward until `###AGENTDECK_END###` and extracts the structured fields. Everything between the last relay injection point and the start of `###AGENTDECK_DONE###` is treated as the agent's raw working output.

### Why this sentinel is safe from false positives

The string `###AGENTDECK_DONE###` is unusual enough that it will not appear in normal code, comments, or output generated by an agent doing its work. If an agent writes code that happens to contain the word "DONE", this is not triggered. Only the exact uppercase delimited block matters.

### Sentinel parsing (pseudocode)

```typescript
function parseSentinel(buffer: string): OrchestratorTaskOutput | null {
  const startMarker = '###AGENTDECK_DONE###';
  const endMarker   = '###AGENTDECK_END###';
  
  const startIdx = buffer.indexOf(startMarker);
  if (startIdx === -1) return null;
  
  const endIdx = buffer.indexOf(endMarker, startIdx);
  if (endIdx === -1) return null; // not yet complete
  
  const block = buffer.slice(startIdx + startMarker.length, endIdx).trim();
  const raw   = stripAnsiCodes(buffer.slice(0, startIdx));
  
  return {
    raw,
    taskId:        extractField(block, 'task_id'),
    summary:       extractField(block, 'summary'),
    filesModified: extractField(block, 'files_modified')
                     .split(',').map(s => s.trim()).filter(Boolean),
    needs:         extractField(block, 'needs'),
  };
}
```

### ANSI stripping

Terminal output contains ANSI escape codes for colors, cursor movement, and formatting. These must be stripped before Ollama processes the text, otherwise the relay prompt will be full of garbage characters like `\x1b[32m` or `\x1b[?2004h`. A regex-based stripper handles this:

```typescript
function stripAnsiCodes(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
             .replace(/\x1b\][^\x07]*\x07/g, '')
             .replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
}
```

---

## 6. Core Concept: Ollama as Traffic Controller

### What Ollama is NOT in this system

- ❌ Ollama does not plan how to implement features
- ❌ Ollama does not make architectural decisions
- ❌ Ollama does not write code
- ❌ Ollama does not understand deep technical context
- ❌ Ollama does not generate the task list

The capable agents (Claude Code, Antigravity, etc.) handle all of that.

### What Ollama IS in this system

Ollama runs a **small local model** (e.g. `llama3.2:3b`, `qwen2.5:7b`, `mistral:7b`) and performs only these mechanical tasks:

| Task | What it means |
|---|---|
| **Strip noise** | Remove terminal system output, shell prompts, file listings, and escape codes — keep only what the agent actually said |
| **Distill summary** | Take the agent's completed work description and compress it to what the next agent actually needs |
| **Craft brief** | Reformat the handoff into a clear, direct task prompt for the next agent, in the style that agent expects |
| **Merge parallel outputs** | When multiple agents finish tasks that all feed into one next task, synthesize their summaries into a single unified context |

### Analogy

Ollama is like an **air traffic controller**. The controller does not design the planes, plan their routes, or fly them. The controller ensures each plane lands on the right runway at the right time, with clear and concise instructions, based on a plan that already exists. The controller's instructions are simple — the planes are the capable ones.

### Why local Ollama specifically

- **No cost** — orchestration calls happen frequently. Using a cloud API for every relay would be expensive.
- **No latency from internet** — local inference is fast enough for this mechanical role.
- **Privacy** — agent outputs often contain proprietary code and architecture. Nothing leaves the machine.
- **No rate limits** — orchestration can run 24/7 without API throttling.
- **Already configured** — the app already has `ollamaHost` in settings, pointing to `http://localhost:11434` by default.

### Ollama offline fallback

If Ollama is not running when a relay is needed, the system must not break. The fallback is **pass-through mode**:

1. The sentinel's `summary` and `needs` fields are already structured text written by the capable agent
2. Instead of calling Ollama to reformat them, the orchestrator assembles a brief directly:
   ```
   [Context from previous task]
   Summary: {output.summary}
   What you need to know: {output.needs}
   
   Your task: {nextTask.description}
   ```
3. This brief is dispatched directly without Ollama involvement
4. A `ConductorLogEntry` of type `'info'` is emitted: "Ollama offline — using pass-through relay"

The result is slightly less polished formatting but fully functional task handoff. The sentinel fields (`summary`, `needs`) exist precisely to enable this fallback — the capable agents writing those fields are doing the distillation work themselves.

---

## 7. Core Concept: The Task Graph & Dependency Engine

### The task graph

Every orchestration run is defined by a **task graph** — a directed acyclic graph (DAG) where:
- Each **node** is a task (a unit of work assigned to one agent session)
- Each **directed edge** is a dependency ("Task B cannot start until Task A is done")

Tasks with no incoming edges start immediately. Tasks with incoming edges wait until all their dependencies are marked `done`.

### Task states

```
pending   →   running   →   done
              ↓
            failed  →  (retry → pending)
```

- `pending`: Task exists in the plan but has not been dispatched yet. Either it has unresolved dependencies, or the run has not started.
- `running`: Task has been dispatched to an agent (injected via `write_pty`). The Buffer Watcher is monitoring that session.
- `done`: The sentinel was detected and parsed. Output is stored.
- `failed`: The agent produced an error, timed out, or the user manually marked it failed. Can be retried.

### The dispatcher loop

The dispatcher runs after every sentinel detection and also at plan start. It must check **two conditions** before dispatching: all dependencies done, AND the target session is not already busy with another task.

```
function dispatchReady(plan: OrchestratorPlan):
  for each task in plan.tasks:
    if task.status === 'pending':

      allDepsDone = task.dependsOn.every(depId =>
        plan.tasks.find(t => t.id === depId)?.status === 'done'
      )

      sessionBusy = plan.tasks.some(t =>
        t.assignedSessionId === task.assignedSessionId &&
        t.status === 'running'
      )

      if allDepsDone AND NOT sessionBusy:
        dispatch(task)   // inject via write_pty + '\n'
        task.status = 'running'
        task.startedAt = Date.now()
```

This runs every time a task completes. It naturally handles N agents because it operates on session IDs, not hardcoded agent names. A session can only run one task at a time — if it is busy, the newly unblocked task waits until it becomes free.

### Hung task / timeout handling

If an agent crashes, gets stuck in a loop, or simply never outputs the sentinel, the plan hangs forever without a timeout mechanism. Every running task has a configurable timeout:

- Default timeout: 30 minutes (configurable in Settings)
- A timer starts when a task transitions to `running`
- If the timer fires before the sentinel is detected:
  - Task is auto-marked `failed`
  - A `ConductorLogEntry` of type `error` is emitted
  - The user sees a warning in the pipeline board
  - The user can choose to **retry** (resets to `pending`) or **force-complete** (uses the current buffer content as the output and marks `done`)
- The **"Force Complete"** action in the UI is also available at any time for a running task — the user clicks it when they can see in the terminal that the agent actually finished but forgot to output the sentinel

```typescript
// Added to OrchestratorEngine interface
retryTask(taskId: string): void;
forceCompleteTask(taskId: string): void; // uses current buffer as output
```

### Parallel tasks

If two tasks both have no dependencies (or all their dependencies are already `done`), the dispatcher fires both at the same time. Both agents receive their task prompt simultaneously via `write_pty`. Both run independently. The Buffer Watcher monitors both sessions simultaneously.

### Fan-in (waiting for multiple agents)

When Task C depends on both Task A and Task B, Task C stays `pending` until both A and B are `done`. Once both are complete, before dispatching Task C, the Ollama relay merges A's output and B's output into a single unified brief for Task C's agent.

---

## 8. Core Concept: How Plans Are Created

There are three paths to creating a task plan. All three produce the same data structure (`OrchestratorPlan`) and feed into the same dependency engine.

### Path 1 — User defines it manually (always available)

The user uses the Plan Builder UI to:
1. Add tasks one by one
2. Write the description for each
3. Assign each to an agent session
4. Draw dependency connections (drag arrows between tasks)
5. Hit "Approve & Run"

This is always available regardless of what AI services are running.

### Path 2 — A capable agent generates the plan (recommended)

The user describes the goal in natural language. That description is sent to one of the capable agents (e.g. Claude Code) running in a terminal. The agent is asked to respond with a structured JSON task plan. The app parses that JSON, loads it into the Plan Builder for user review, and the user approves it.

This is the best path because:
- The capable agent understands the actual codebase and architecture
- The capable agent produces better task breakdowns than any small model
- The user still reviews before execution

**Prompt sent to the capable agent:**

```
You are helping plan a multi-agent task execution.

Goal: {user's goal}

Available agent sessions:
{foreach session: "- Session {n}: {agent.name} — {agent.bestUsedFor}"}

Produce a task plan as a JSON array. Each task must have:
- id: unique string (e.g. "task-1")
- title: short name
- description: full task instructions for the agent (what to do, not how)
- assignedSessionId: one of the session IDs listed above
- dependsOn: array of task IDs this task must wait for (empty array = starts immediately)

Wrap your JSON in these exact markers so AgentDeck can extract it reliably:
###AGENTDECK_PLAN_START###
[...your JSON array here...]
###AGENTDECK_PLAN_END###
```

**How the app receives this plan:**

The Buffer Watcher runs in a special `watchForPlan` mode on the selected session (distinct from `watchForSentinel` mode — they must not conflict):

```typescript
// Buffer Watcher operates in one of two modes per session:
type WatchMode = 'sentinel' | 'plan';

// The plan markers are different from the task sentinel markers to avoid any confusion:
const PLAN_START = '###AGENTDECK_PLAN_START###';
const PLAN_END   = '###AGENTDECK_PLAN_END###';
```

Once `###AGENTDECK_PLAN_END###` is detected, the content between the markers is parsed as JSON, validated against the `OrchestratorTask` schema, and loaded into the Plan Builder. If JSON parsing fails, an error is shown and the user can retry or paste manually.

### Path 3 — Rough sketch from Ollama (quick start)

If no capable agent session is running, the user can ask Ollama to produce a rough task sketch. Ollama at this role is explicitly not expected to produce high-quality implementation descriptions — it just provides a starting structure that the user edits in the Plan Builder before approving. It is a convenience, not a source of truth.

---

## 9. Full Orchestration Flow — Step by Step

This is the complete sequence from user input to all tasks completing.

```
Step 1: User opens Conductor view
        → Selects active workspace
        → Opens terminal sessions for each agent they want to use
        → Starts the agent CLI in each session (e.g. types "claude" in tab 1, 
          "antigravity" in tab 2)
        → Labels each session: "This is Claude Code", "This is Antigravity"
          (Session Registry — maps ephemeral session UUIDs to registered Agent IDs)

Step 2: User enters the overall goal
        → e.g. "Build a JWT authentication system with tests"

Step 3: Plan is created (one of the three paths)
        → User reviews the task graph in Plan Builder
        → User adjusts tasks, reassigns sessions, edits dependencies if needed
        → User approves the plan

Step 4: User hits "Run"
        → Plan status changes from 'draft' to 'running'
        → Dispatcher runs for the first time

Step 5: Dispatcher identifies tasks with no dependencies
        → For each: checks session is not already busy (one task per session at a time)
        → Formats the dispatch prompt
        → Calls write_pty(sessionId, dispatchPrompt + '\n') for each  ← '\n' is mandatory
        → Sets those tasks to 'running', records startedAt timestamp
        → Starts timeout timer for each dispatched task

        The dispatch prompt format:
        ─────────────────────────────────────────────
        TASK ID: {task.id}
        OVERALL GOAL: {plan.goal}
        
        YOUR TASK:
        {task.description}
        
        When you have fully completed this task, output:
        ###AGENTDECK_DONE###
        task_id: {task.id}
        summary: {what you did}
        files_modified: {files list or "none"}
        needs: {what next agent needs or "none"}
        ###AGENTDECK_END###
        ─────────────────────────────────────────────

Step 6: Buffer Watcher is active on all 'running' sessions
        → Listens to pty-data-{sessionId} events
        → Appends output to per-session string buffer
        → After each append, calls parseSentinel(buffer)
        → If parseSentinel returns null: continue accumulating
        → If parseSentinel returns an OrchestratorTaskOutput: proceed to Step 7

Step 7: Sentinel detected for a task
        → Mark the task as 'done'
        → Store the parsed OrchestratorTaskOutput on the task
        → Clear the session's buffer (ready for next task on same session)
        → Log the completion in the Conductor UI
        → Run the dispatcher again (Step 8)

Step 8: Dispatcher checks for newly unblocked tasks
        → Finds tasks whose all dependsOn tasks are now 'done'
        → For each newly unblocked task:

            Case A — single dependency (one parent task):
            → Try: Call Ollama relay (single input)
            → If Ollama offline: fall back to pass-through mode (use sentinel
              summary + needs fields directly as the brief, no reformatting)
            → Ollama (or fallback) returns a clean brief
            → Append sentinel instruction to the brief
            → write_pty(task.assignedSessionId, brief + sentinelInstruction + '\n')
            → Set task to 'running', start timeout timer

            Case B — multiple dependencies (fan-in):
            → Collect all parent tasks' outputs
            → Try: Call Ollama relay (multi input merge)
            → If Ollama offline: concatenate all summaries and needs as plain text
            → Append sentinel instruction
            → write_pty(task.assignedSessionId, brief + sentinelInstruction + '\n')
            → Set task to 'running', start timeout timer

            Case C — no parents (independent task, dispatched after a pause or retry):
            → Format dispatch prompt directly (no relay needed)
            → write_pty(sessionId, dispatchPrompt + sentinelInstruction + '\n')
            → Set task to 'running', start timeout timer

Step 9: Repeat Steps 6–8 until all tasks are 'done' or 'failed'
        → Plan status changes to 'done'
        → Final outputs are aggregated and shown in Conductor
        → User can save outputs to Prompt Vault
```

---

## 10. Parallel vs Sequential Execution

### Sequential example (A → B → C)

```
Task A: "Write the DB schema"          dependsOn: []
Task B: "Write the auth middleware"    dependsOn: ["task-a"]
Task C: "Write integration tests"      dependsOn: ["task-b"]

Timeline:
t=0   Dispatcher fires Task A
      [Session 1] ████████████ (Task A running)
t=1   Task A done, sentinel received
      Ollama relays A's output → brief for Task B
      [Session 1] (idle)  [Session 2] ████████████ (Task B running)
t=2   Task B done, sentinel received
      Ollama relays B's output → brief for Task C
      [Session 1] ████████████ (Task C running)  [Session 2] (idle)
t=3   Task C done. Plan complete.
```

### Parallel example (A+B in parallel → C waits for both)

```
Task A: "Write the token generation logic"    dependsOn: []
Task B: "Write the API route stubs"           dependsOn: []
Task C: "Write tests for both A and B"        dependsOn: ["task-a", "task-b"]

Timeline:
t=0   Dispatcher fires Task A AND Task B simultaneously
      [Session 1] ████████████ (Task A)
      [Session 2] ████████ (Task B — finishes faster)

t=1   Task B done (Task A still running)
      → Task C still has unresolved dep (task-a), stays pending
      → Nothing dispatched yet

t=2   Task A done
      → Both A and B are now done
      → Task C's deps are fully resolved
      → Ollama MERGES A's output + B's output → unified brief for Task C
      [Session 1] (idle)
      [Session 2] (idle)
      [Session 3] ████████████ (Task C running on a third session)

t=3   Task C done. Plan complete.
```

### Mixed example (real world)

```
Task 1: "Write DB schema"              assignedTo: Session1   dependsOn: []
Task 2: "Write API route structure"    assignedTo: Session2   dependsOn: []
Task 3: "Write auth business logic"    assignedTo: Session3   dependsOn: []
Task 4: "Write DB migrations"          assignedTo: Session1   dependsOn: [task-1]
Task 5: "Write auth middleware"        assignedTo: Session2   dependsOn: [task-2, task-3]
Task 6: "Write integration tests"      assignedTo: Session3   dependsOn: [task-4, task-5]
Task 7: "Final review & cleanup"       assignedTo: Session1   dependsOn: [task-6]

t=0   Tasks 1, 2, 3 fire in parallel (all three sessions busy)
t=?   Task 1 done → Task 4 unblocked → dispatched to Session 1
t=?   Task 2+3 done → Task 5 unblocked (fan-in) → dispatched to Session 2
t=?   Task 4+5 done → Task 6 unblocked (fan-in) → dispatched to Session 3
t=?   Task 6 done → Task 7 → final cleanup
```

### Key rule

A session can only run one task at a time (because it is a real interactive terminal process). If Session 1 is running Task 4, no new task is dispatched to Session 1 until Task 4 completes. The dispatcher naturally handles this: it checks if the session already has a running task before dispatching.

---

## 11. Data Models

These types are added to `src/types/index.ts`.

```typescript
// ── Orchestrator Task ──────────────────────────────────────────────────────────

export type OrchestratorTaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface OrchestratorTask {
  id: string;
  title: string;
  
  /** 
   * Full task instructions sent to the agent. Written by user or generated
   * by a capable agent. The orchestrator appends the sentinel instruction
   * automatically — this field does NOT include it.
   */
  description: string;
  
  /** Which PTY session this task runs in. Maps to a TerminalSession.id. */
  assignedSessionId: string;
  
  /** Which registered Agent this session belongs to (for display only). */
  assignedAgentId: string;
  
  /**
   * IDs of tasks that must be 'done' before this task can be dispatched.
   * Empty array = no dependencies, fires as soon as the plan starts.
   */
  dependsOn: string[];
  
  status: OrchestratorTaskStatus;
  
  /** Unix timestamp (ms) when write_pty was called to dispatch this task. */
  startedAt?: number;
  
  /** Unix timestamp (ms) when sentinel was detected. */
  completedAt?: number;
  
  /** Populated after sentinel detection. */
  output?: OrchestratorTaskOutput;
}

// ── Task Output ────────────────────────────────────────────────────────────────

export interface OrchestratorTaskOutput {
  /** 
   * Raw terminal output from the session, stripped of ANSI codes,
   * from the last dispatch point up to the sentinel start. 
   */
  raw: string;
  
  /** Matches the task_id field in the sentinel block. */
  taskId: string;
  
  /** Extracted from the sentinel's summary field. */
  summary: string;
  
  /** Extracted from the sentinel's files_modified field. */
  filesModified: string[];
  
  /** Extracted from the sentinel's needs field. */
  needs: string;
  
  /** 
   * The brief Ollama generated for the next agent, stored for display
   * in the Conductor log. Populated after Ollama relay completes.
   */
  relayedBrief?: string;
}

// ── Orchestrator Plan ──────────────────────────────────────────────────────────

export type OrchestratorPlanStatus = 
  | 'draft'      // Being built in Plan Builder, not yet run
  | 'approved'   // User approved, ready to run
  | 'running'    // At least one task is 'running'
  | 'paused'     // User paused mid-run
  | 'done'       // All tasks 'done'
  | 'failed';    // At least one task 'failed' and run stopped

export interface OrchestratorPlan {
  id: string;
  goal: string;
  tasks: OrchestratorTask[];
  status: OrchestratorPlanStatus;
  createdAt: number;    // Unix ms
  completedAt?: number; // Unix ms
}

// ── Per-session Buffer State (in-memory only, not persisted) ──────────────────

export interface SessionBuffer {
  sessionId: string;
  /** Accumulated raw output since last dispatch or last clear. */
  buffer: string;
  /** Unix ms of when the last pty-data chunk arrived. */
  lastActivity: number;
  /** Current watch mode for this session. */
  mode: 'sentinel' | 'plan' | 'idle';
}

// ── Session Registry (in-memory, rebuilt each run) ────────────────────────────
// Maps an ephemeral PTY session UUID to a registered Agent.
// Session UUIDs are generated fresh each app launch by TerminalContainer.
// This registry is how the Conductor knows which agent is in which terminal.

export interface SessionRegistryEntry {
  sessionId: string;       // TerminalSession.id (UUID from TerminalContainer)
  agentId: string;         // Agent.id from the Agent Registry
  agentName: string;       // For display
  agentColor: string;      // For display
  workspaceId: string;     // Which workspace this session belongs to
}

// ── Terminal Session (lifted to DashboardContext) ─────────────────────────────
// Previously local to TerminalContainer. Must be lifted so ConductorView
// can read the list of active sessions for the plan builder and dispatcher.

export interface TerminalSession {
  id: string;
  title: string;
  shell: string;
  shellArgs: string[];
  workspaceId: string;
  /** Set by user in Session Registry panel. null = unassigned. */
  assignedAgentId: string | null;
}

// ── Conductor Log Entry ───────────────────────────────────────────────────────

export interface ConductorLogEntry {
  id: string;
  timestamp: number;
  type: 'dispatch' | 'sentinel' | 'relay' | 'timeout' | 'error' | 'info' | 'user-override';
  message: string;
  taskId?: string;
  sessionId?: string;
}
```

---

## 12. New Services to Build

All new services live in `src/services/`.

### `bufferWatcher.ts`

Responsibility: Subscribe to `pty-data-{sessionId}` Tauri events for all active sessions. Accumulate output. Detect the sentinel OR the plan JSON response depending on mode. Notify the orchestrator engine.

```typescript
interface BufferWatcher {
  // MODE 1: Watch for task completion sentinel.
  // Called when the orchestrator dispatches a task to a session.
  watchForSentinel(
    sessionId: string,
    onSentinel: (output: OrchestratorTaskOutput) => void
  ): void;

  // MODE 2: Watch for a plan JSON response from a capable agent.
  // Called during Phase 5 plan generation. Uses different markers
  // (###AGENTDECK_PLAN_START### / ###AGENTDECK_PLAN_END###) so it
  // never conflicts with sentinel detection.
  watchForPlan(
    sessionId: string,
    onPlan: (rawJson: string) => void,
    onError: (err: string) => void
  ): void;

  // Clear the buffer for a session (called after sentinel/plan detected).
  clearBuffer(sessionId: string): void;

  // Stop watching a session (called when session is closed or plan stops).
  unwatch(sessionId: string): void;

  // Get current raw buffer content (for live display in ConductorLog).
  getBuffer(sessionId: string): string;
}
```

Implementation notes:
- Uses `listen('pty-data-{sessionId}', handler)` from `@tauri-apps/api/event`
- Stores one `SessionBuffer` per session ID in a `Map<string, SessionBuffer>`
- Each buffer has a `mode` field (`'sentinel' | 'plan' | 'idle'`)
- In `sentinel` mode: after each append, calls `parseSentinel(buffer)`
- In `plan` mode: after each append, looks for `###AGENTDECK_PLAN_START###` and `###AGENTDECK_PLAN_END###` pair
- A session can only be in one mode at a time — switching modes clears the buffer

### `sentinelParser.ts`

Responsibility: Parse the sentinel block from a buffer string. Strip ANSI codes.

```typescript
function parseSentinel(buffer: string): OrchestratorTaskOutput | null
function stripAnsiCodes(text: string): string
function extractField(block: string, field: string): string
```

### `orchestratorEngine.ts`

Responsibility: Hold the active plan state. Run the dispatcher. Coordinate between the buffer watcher and the Ollama relay.

```typescript
interface OrchestratorEngine {
  // Load a plan and start running it
  start(plan: OrchestratorPlan): void;

  // Pause all running activity (stops dispatching new tasks; active tasks continue
  // running in their terminals but their sentinels will be held until resumed)
  pause(): void;

  // Resume from paused
  resume(): void;

  // Manually mark a task as failed (stops its timeout timer)
  failTask(taskId: string): void;

  // Retry a failed task: resets it to 'pending' and re-runs the dispatcher
  retryTask(taskId: string): void;

  // Force a running task to 'done' using whatever is in the buffer right now.
  // Use when the agent finished but didn't output the sentinel.
  forceCompleteTask(taskId: string): void;

  // Inject a raw message into any session, bypassing the orchestrator flow.
  // The '\n' is appended automatically.
  injectMessage(sessionId: string, message: string): void;

  // Subscribe to plan state updates (for UI rendering).
  // Returns an unsubscribe function.
  onStateChange(cb: (plan: OrchestratorPlan) => void): () => void;

  // Subscribe to conductor log entries (for ConductorLog display).
  // Returns an unsubscribe function.
  onLog(cb: (entry: ConductorLogEntry) => void): () => void;
}
```

### `ollamaRelay.ts`

Responsibility: Call the local Ollama API to reformat and relay outputs between agents.

```typescript
interface OllamaRelayInput {
  goal: string;
  completedTasks: Array<{
    taskDescription: string;
    agentName: string;
    agentDescription: string;
    output: OrchestratorTaskOutput;
  }>;
  nextTask: {
    description: string;
    agentName: string;
    agentDescription: string;
  };
  ollamaHost: string;
  model: string;
}

async function relayViaOllama(input: OllamaRelayInput): Promise<string>
// Returns: the formatted brief string for the next agent
```

---

## 13. New UI Components to Build

All new components live in `src/components/`.

### `ConductorView.tsx` — Main orchestration interface

This is the new primary view accessed from the sidebar. It contains:
- Goal input at the top
- Three tabs: **Plan**, **Run**, **History**
- **Plan tab**: Shows the PlanBuilder
- **Run tab**: Shows the PipelineBoard + ConductorLog (only active once plan is approved)
- **History tab**: Past completed orchestration runs

### `PipelineBoard.tsx` — Visual N-lane pipeline

Displays all sessions as horizontal lanes. Tasks flow left to right as cards within each lane. Dependency arrows between lanes show blocking relationships.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Overall Goal: Build JWT auth system                                     │
├─────────────────┬──────────────────┬──────────────────┬─────────────────┤
│ Session 1       │ Session 2        │ Session 3        │                 │
│ Claude Code     │ Antigravity      │ Hermes           │                 │
│                 │                  │                  │                 │
│ [✓ DB Schema]──▶│ [● Auth Mid.. ] │ [✓ Token Logic]  │                 │
│ [○ Migrations]  │                  │ [○ Tests      ]  │                 │
│                 │                  │       ↑──────────┘                 │
│                 │                  │   (waits for session 2)            │
└─────────────────┴──────────────────┴──────────────────┴─────────────────┘
  ✓ = done   ● = running   ○ = pending   ✗ = failed
```

### `PlanBuilder.tsx` — Task plan creator/editor

A form-based interface for creating and editing task plans:
- Add/remove task cards
- Edit task title, description, assigned session
- Set dependencies by selecting from a dropdown of other task IDs
- Shows a simple text representation of the dependency graph
- "Generate with Agent" button — sends goal to a capable agent, parses the JSON response, fills the plan
- "Approve Plan" button — locks the plan and enables Run tab

### `TaskCard.tsx` — Individual task display

Shows in both PlanBuilder (editable) and PipelineBoard (read-only). Displays:
- Title
- Assigned agent name + color indicator
- Status badge (pending / running / done / failed)
- When running: elapsed time
- When done: summary from sentinel output, files modified
- Expandable raw output view

### `ConductorLog.tsx` — Real-time orchestration log

A chronological log of all orchestrator events shown during a run:
- Task dispatched to session X
- Sentinel received from session X for task Y
- Ollama relay: summary of what was extracted and what brief was sent
- Timeout warnings
- Errors
- User interventions (manual injections, pauses, force-completes)

### `SessionRegistry.tsx` — Session ↔ Agent assignment panel

Solves a critical practical problem: PTY session IDs are ephemeral UUIDs regenerated every app launch. The Conductor needs to know which registered Agent is running in which session before a plan can be built or run.

This panel appears at the top of `ConductorView` and shows all active terminal sessions for the current workspace. The user assigns each session to a registered agent by selecting from a dropdown:

```
┌────────────────────────────────────────────────────────┐
│ Active Sessions                                        │
├──────────────────────┬─────────────────────────────────┤
│ PowerShell 1         │ Assigned to: [Claude Code    ▼] │
│ PowerShell 2         │ Assigned to: [Antigravity    ▼] │
│ Git Bash 1           │ Assigned to: [Hermes         ▼] │
└──────────────────────┴─────────────────────────────────┘
```

Once assigned, the session label updates to show the agent name and color throughout the app. This assignment is stored in the `TerminalSession.assignedAgentId` field (lifted to `DashboardContext`). Plans reference sessions by their ID, so when the user re-opens the app and sessions regenerate, they just re-assign in this panel before running.

### `ManualOverridePanel.tsx` — User injection control

A collapsible panel inside `ConductorView` (visible during a run) that lets the user directly inject messages into any session, bypassing the automated orchestration flow. Use cases:

- Correcting an agent mid-task ("Actually, use Postgres not SQLite")
- Answering a question the agent asked
- Providing context that wasn't in the original task description

```
┌──────────────────────────────────────────────────────┐
│ Manual Override                                      │
│ Session: [PowerShell 1 — Claude Code ▼]             │
│ ┌────────────────────────────────────────────────┐  │
│ │ Type message to inject...                      │  │
│ └────────────────────────────────────────────────┘  │
│ [Inject →]   [Force Complete Task]   [Fail Task]    │
└──────────────────────────────────────────────────────┘
```

All injected messages are logged in `ConductorLog` with type `'user-override'`.

---

## 14. Ollama Relay Prompt Templates

These are the exact prompts used by `ollamaRelay.ts`.

### System prompt (used for all relay calls)

```
You are a message relay for a multi-agent coding workflow.
Your only job is to reformat completed task output into a clear brief for the next agent.

Rules you must follow:
1. Extract only meaningful results. Ignore shell prompts, file listings, compilation noise, and status messages.
2. Keep your output under 200 words.
3. Do NOT add implementation suggestions or technical opinions.
4. Do NOT explain what you are doing.
5. Write in direct, imperative style addressed to the next agent.
6. Preserve any specific identifiers mentioned (function names, file paths, API contracts).
```

### Single-dependency relay prompt

```
Overall goal: {plan.goal}

COMPLETED WORK:
Task: {completedTask.taskDescription}
Done by: {completedTask.agentName} ({completedTask.agentDescription})
Summary: {completedTask.output.summary}
Files modified: {completedTask.output.filesModified.join(', ') || 'none'}
What is needed next: {completedTask.output.needs}

NEXT TASK:
Task: {nextTask.description}
Next agent: {nextTask.agentName} ({nextTask.agentDescription})

Write a clear, direct brief for the next agent that gives them everything they need:
```

### Multi-dependency merge prompt (fan-in)

```
Overall goal: {plan.goal}

COMPLETED WORK FROM MULTIPLE AGENTS:
{foreach completedTask:
---
Task: {task.taskDescription}
Done by: {task.agentName} ({task.agentDescription})
Summary: {task.output.summary}
Files modified: {task.output.filesModified.join(', ') || 'none'}
What is needed next: {task.output.needs}
---
}

NEXT TASK:
Task: {nextTask.description}
Next agent: {nextTask.agentName} ({nextTask.agentDescription})

Synthesize the completed work into a single unified brief for the next agent:
```

---

## 15. Agent Setup — CLAUDE.md Protocol

For agents that support project-level configuration files (Claude Code uses `CLAUDE.md`), you can bake the sentinel protocol permanently into the project so agents always know the signal format without needing it injected each time.

### Recommended `CLAUDE.md` addition

Place this in any project folder where Claude Code will be used with AgentDeck:

```markdown
## AgentDeck Multi-Agent Protocol

You are running as part of an AgentDeck multi-agent workflow.

When you receive a task with a `TASK ID:` prefix, you are operating under orchestration.
Complete the task as instructed. When you are fully done — not mid-work — output the 
completion signal below, exactly as shown, on its own lines:

###AGENTDECK_DONE###
task_id: {the task_id from your instructions}
summary: {2–3 sentences: what you built, what changed, key decisions made}
files_modified: {comma-separated list of files you created or modified, or "none"}
needs: {what the next agent or step will need, or "none"}
###AGENTDECK_END###

Rules:
- Output this signal ONCE, only when fully complete.
- Do not output it mid-task or as a placeholder.
- Do not include any other text on the same lines as the delimiters.
- The task_id must exactly match the one given in your instructions.
```

### For agents without CLAUDE.md support

The orchestrator engine always appends the sentinel instruction directly to the dispatch prompt (Step 5 in the flow). The CLAUDE.md file is a convenience optimization — it means the instruction doesn't have to be in every single prompt, keeping dispatched prompts shorter. It is not required for the system to work.

---

## 16. What Changes in Existing Code

### `src/types/index.ts`
- Add: `OrchestratorTask`, `OrchestratorTaskOutput`, `OrchestratorPlan`, `OrchestratorPlanStatus`, `OrchestratorTaskStatus`, `SessionBuffer`
- Add: `ConductorLogEntry` type
- No changes to existing types

### `src/services/storage.ts`
- Add: `loadPlans() / savePlans()` functions for persisting `OrchestratorPlan[]` to a separate `agentdeck_plans.json` file in AppData
- No changes to existing functions

### `src/context/DashboardContext.tsx`
- Add: `plans: OrchestratorPlan[]` state
- Add: `activePlanId: string | null` state
- Add CRUD functions: `addPlan`, `updatePlan`, `deletePlan`
- **Lift terminal sessions from `TerminalContainer` local state:**
  - Add: `terminalSessions: TerminalSession[]` state (keyed per workspace)
  - Add: `addTerminalSession`, `removeTerminalSession`, `updateTerminalSession` functions
  - `TerminalContainer` reads from and writes to context instead of local state
  - This allows `ConductorView` and `SessionRegistry` to read the same session list
- No changes to other existing state or functions

### `src/components/Sidebar.tsx`
- Add: "Conductor" navigation item with a new icon (e.g. `Network` from lucide-react)
- No other changes

### `src/components/AgentSandbox.tsx`
- Rename the view label to **"Simulation"** in the sidebar
- Add a header note explaining it is a brainstorming/prototyping tool (one LLM simulating agents) separate from the real Conductor orchestration
- No functional changes to its logic

### Rust backend (`src-tauri/src/lib.rs`)
- **No changes needed.** The existing `write_pty`, `pty-data-*` events, and all other commands are sufficient for the full orchestration system.

---

## 17. Implementation Roadmap

### Phase 1 — Foundation Services (no UI yet)

Build and test these services in isolation before building any UI:

1. **`sentinelParser.ts`** — write unit tests with sample terminal output strings. Verify ANSI stripping works correctly. Verify edge cases (sentinel split across two buffer chunks, sentinel inside code comments).

2. **`bufferWatcher.ts`** — wire up to real Tauri `pty-data-*` events. Test with a real terminal session. Manually type the sentinel token in a terminal and verify it is detected.

3. **`ollamaRelay.ts`** — test against a running Ollama instance with sample completed task outputs. Verify the relay produces sensible briefs. Tune the system prompt if needed.

4. **`orchestratorEngine.ts`** — unit test the dispatcher logic with mock task graphs. Test sequential chains, parallel fan-out, fan-in merging.

### Phase 2 — Data Layer

5. Add new types to `src/types/index.ts` (all types defined in Section 11)
6. Add plan persistence to `src/services/storage.ts` (`loadPlans` / `savePlans` to `agentdeck_plans.json`)
7. **Lift terminal sessions to `DashboardContext`** — move `TerminalSession[]` state out of `TerminalContainer` local state and into context; update `TerminalContainer` to read/write from context
8. Add plan state and session state to `src/context/DashboardContext.tsx`

### Phase 3 — Conductor UI (core)

9. **`SessionRegistry.tsx`** — session ↔ agent assignment panel; must exist before plan builder works
10. **`ConductorView.tsx`** — shell with tabs (Plan / Run / History), goal input, session registry at top
11. **`PlanBuilder.tsx`** — manual task creation, session picker (from registry), dependency wiring, approve button
12. **`PipelineBoard.tsx`** — N-lane visual display, task cards, basic status badges (pending/running/done/failed)
13. **`ConductorLog.tsx`** — real-time event log
14. **`ManualOverridePanel.tsx`** — inject messages, force-complete, fail task controls

### Phase 4 — Integration

15. Wire `ConductorView` into the sidebar navigation
16. Connect `orchestratorEngine` to `PipelineBoard` via `onStateChange` subscription
17. Connect `orchestratorEngine` to `ConductorLog` via `onLog` subscription
18. Wire the "Run" button to `orchestratorEngine.start()`
19. Wire "Pause" / "Resume" controls
20. Wire `ManualOverridePanel` to `orchestratorEngine.injectMessage()`, `forceCompleteTask()`, `failTask()`, `retryTask()`
21. Wire timeout handling — configurable timeout value in Settings, timer starts in dispatcher

### Phase 5 — Plan Generation from Capable Agent

22. Add "Generate with Agent" button to `PlanBuilder`
23. Show a session picker (which agent session to ask)
24. Inject the plan-generation prompt via `write_pty` + `'\n'`
25. Switch Buffer Watcher to `plan` mode on that session
26. Watch for `###AGENTDECK_PLAN_START###` / `###AGENTDECK_PLAN_END###` markers
27. Parse the JSON between markers and validate schema
28. Load validated tasks into `PlanBuilder` for user review and approval

### Phase 6 — Polish

29. Task card expandable raw output viewer
30. Dependency arrow visualization in `PipelineBoard`
31. Plan history in `ConductorView` history tab (completed plans stored in `agentdeck_plans.json`)
32. Export plan run transcript to Prompt Vault
33. Keyboard shortcuts for pause/resume/inject
34. CLAUDE.md generation helper in Settings (copies the ready-made CLAUDE.md block to clipboard)
35. Ollama status indicator in Conductor header (shows online/offline, switches relay mode automatically)

---

## Summary

AgentDeck solves the multi-agent isolation problem by turning the app itself into the coordination layer. Real agents run in real terminal sessions. Ollama — using a small local model — acts purely as a mechanical relay: stripping noise, reformatting output, and crafting briefs for the next agent. If Ollama is offline, the system falls back to pass-through relay using the sentinel's structured fields directly. Agents signal completion with the `###AGENTDECK_DONE###` sentinel token. The dependency engine determines what runs in parallel and what must wait, with one-task-per-session enforcement and configurable timeout handling. Hung tasks can be force-completed or retried by the user. The Session Registry maps ephemeral PTY session UUIDs to registered agents so the plan builder and dispatcher always know which terminal belongs to which agent. The Buffer Watcher operates in two modes — sentinel detection during task execution, plan-JSON detection during plan generation — using separate markers to avoid conflicts. Every `write_pty` call appends `\n` to execute. The plan can be created manually, generated by a capable agent (the recommended path), or sketched by Ollama as a rough starting point. The Rust PTY backend requires zero changes. The entire orchestration system is built in JavaScript/TypeScript on top of the existing infrastructure.
