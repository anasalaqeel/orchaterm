# Orchaterm — User Guide

> **Version:** 0.1.0 (Beta)
> **Platform:** Windows / macOS / Linux (Tauri desktop app)

---

## Table of Contents

1. [What is Orchaterm?](#1-what-is-orchaterm)
2. [Key Concepts](#2-key-concepts)
3. [App Layout](#3-app-layout)
4. [First-Time Setup (Step by Step)](#4-first-time-setup-step-by-step)
5. [Working with Workspaces](#5-working-with-workspaces)
6. [The Terminal](#6-the-terminal)
7. [The Conductor — Full Walkthrough](#7-the-conductor--full-walkthrough)
   - [Step 1: Set up terminal sessions (in workspace)](#step-1-set-up-terminal-sessions)
   - [Step 2: Build a Plan](#step-2-build-a-plan)
   - [Step 3: Generate a Plan with an Agent](#step-3-generate-a-plan-with-an-agent)
   - [Step 4: Approve & Run](#step-4-approve--run)
   - [Step 5: Monitor the Pipeline](#step-5-monitor-the-pipeline)
8. [Manual Override](#8-manual-override)
9. [Orchestrator Log](#9-orchestrator-log)
10. [History Tab](#10-history-tab)
11. [Settings Reference](#11-settings-reference)
12. [Sentinel Protocol Reference](#12-sentinel-protocol-reference)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. What is Orchaterm?

Orchaterm solves a real problem: when you run multiple AI coding agents (Claude Code, Antigravity, Hermes, or multiple sessions of the same agent) in separate terminals, they have **no awareness of each other**. They can't share context, they don't know when one finishes, and you have to manually copy outputs between them.

Orchaterm acts as the **orchestration layer** between your agents:

- Each agent runs in its **own real terminal session** inside Orchaterm — exactly as you'd use it normally.
- You define a **task plan** with dependencies (e.g. Agent A must finish before Agent B starts).
- When Agent A finishes, it outputs a structured **sentinel signal**. Orchaterm detects this automatically.
- A local **Ollama model** reads the output and writes a concise brief for Agent B.
- Orchaterm dispatches Agent B's task automatically, injecting the brief as context.

You watch it all happen in the **Pipeline board**, with a live log, and can intervene at any time via **Manual Override**.

---

## 2. Key Concepts

| Term | What it means |
|------|---------------|
| **Workspace** | A project directory. Keeps terminals, logs, and prompts organized per project. |
| **Terminal Session** | A real PTY terminal opened inside Orchaterm. Each tab runs one agent. |
| **Agent Group / Space** | A logical grouping of terminal tabs representing an agent team. Scopes conductor plans and chat logs. |
| **Plan** | A set of tasks with optional dependencies between them. Runs as a directed graph. |
| **Wave** | A group of tasks with no unmet dependencies — they can all run in parallel. |
| **Sentinel** | A structured block agents output when they complete a task. Orchaterm detects it automatically. |
| **Ollama Relay** | A local LLM that reads one agent's output and writes a handoff brief for the next agent. Falls back to pass-through if Ollama is offline. |
| **Conductor** | The main orchestration UI — build plans, run pipelines, monitor progress. |

---

## 3. App Layout

The app has a **left sidebar** and a **main content area**.

### Sidebar

```
┌─────────────────────┐
│  ⬛ Orchaterm       │
│     Developer Hub   │
├─────────────────────┤
│  WORKSPACES         │
│  ● My Project       │  ← click to open terminal for this workspace
│  ● Another Project  │
├─────────────────────┤
│  NAVIGATION         │
│  🗂 Overview         │  → workspace cards + add workspace
│  🌐 Conductor        │  → orchestration
│  📋 Task Log         │  → manual activity log
│  ✨ Prompt Vault     │  → saved prompts library
│  ⚙️ Settings         │  → shell, Ollama, API keys
├─────────────────────┤
│  v0.1.0 (Beta)  🌙  │
└─────────────────────┘
```

### Overview page (`/`) — two modes

- **Grid mode** — shown when you click **Overview** in the nav. Displays workspace cards and a **"+ Add Workspace"** button.
- **Console mode** — shown when you **click a workspace name in the sidebar**. Splits the screen into a left terminal panel and a right context panel.

Switch between them: click a workspace in the sidebar (→ console), or click **Overview** in the nav (→ grid).

### Console mode layout

```
┌────────────────────────────┬────────────────────────────┐
│                            │  [Workspace] [Conductor]   │ ← right panel tabs
│    Terminal Tabs            │                            │
│    ┌────┬────┬────┐        │  Workspace tab:            │
│    │ PS1│ PS2│ +  │        │   · Terminal Sessions      │
│    └────┴────┴────┘        │   · Current Task           │
│                            │   · Conductor Status       │
│    (active terminal)       │   · Recent Task Logs       │
│                            │                            │
│                            │  Conductor tab:            │
│                            │   · Plan selector          │
│                            │   · Build/Pipeline/History │
└────────────────────────────┴────────────────────────────┘
```

The **Conductor is workspace-scoped**: each workspace has its own plans and conductor context, accessible via the right panel tab.

---

## 4. First-Time Setup (Step by Step)

### Step 1 — Configure Settings

Click **Settings** at the bottom of the sidebar.

**Integration Settings:**
- **Terminal Shell Executable** — the shell Orchaterm will open in terminals:
  - Windows: type `powershell.exe` or `cmd.exe`
  - WSL / Linux / macOS: `bash` or `zsh` or `/bin/zsh`
- **Ollama API Host** — leave as `http://localhost:11434` unless Ollama runs on a different port.
- **API Keys** — Optional. Enter your Anthropic/OpenAI keys if your agents need them from environment.

Click **Save Integration Settings**.

**Conductor Settings:**
- Click **Refresh** next to "Ollama Relay Model" — this loads your locally installed Ollama models.
- Select a model from the dropdown (e.g. `llama3.2:latest` or `mistral:latest`). If you have no models yet, install one (see below).
- Set the **Task Timeout** — how many minutes a task can run before being auto-failed (default: 30).

Click **Save Conductor Settings**.

> **Install Ollama (recommended):** Download from https://ollama.com, then run:
> ```
> ollama pull llama3.2
> ```
> Leave Ollama running (`ollama serve`). Without it, handoffs between agents fall back to raw pass-through — the pipeline still works, just less refined.

---

### Step 2 — Create a Workspace

A workspace maps to one of your project directories on disk.

1. Click **Overview** in the sidebar nav.
2. Click **+ Add Workspace** (the card with a "+" icon in the grid).
3. Fill in:
   - **Name** — e.g. `My API Project`
   - **Path** — the full local path to your project directory, e.g. `C:\Users\you\projects\myapi`
   - **Description** — optional, free text
   - **Color** — pick a color for visual identification
   - **Status** — leave as `active`
4. Click **Create Workspace**.

The workspace appears in the sidebar immediately.

---

### Step 3 — Open Your Project's Terminal

1. Click your workspace name in the **sidebar** (under Workspaces). This switches to console view.
2. The terminal panel opens with one tab already created.
3. In the terminal, launch your agent — e.g. type `claude` and press Enter.
4. Open additional terminal tabs by clicking **+ New Tab** (top right of the terminal header).
5. Launch a separate agent in each tab.

You're now ready to use the Conductor.

---

## 5. Working with Workspaces

### Grid view

Click **Overview** in the nav. You'll see a card for each workspace showing:
- Status badge (Active / Paused / Idle)
- Current task note (editable inline — click the pencil icon)
- Quick access to recent prompts and task logs

### Console view (terminal)

Click a workspace name in the **sidebar**. The terminal panel fills the main area.

- The terminal opens with a default tab using the shell configured in Settings.
- Use the **shell picker** (top-right dropdown) to choose which shell to use for new tabs.
- **Double-click** a tab title to rename it.
- Click **×** to close a tab.

> **Note:** Terminal sessions are **ephemeral** — they reset each time you restart Orchaterm. You must reopen agent terminals each launch.

### Editing / deleting workspaces

Go to **Settings** → scroll to the Workspaces section. Click the edit ✏ or delete 🗑 icon next to any workspace.

---

## 6. The Terminal

### Shell detection

When you open a workspace terminal, Orchaterm automatically detects available shells on your system and shows them in the **shell picker dropdown** (top-right of the terminal header). The preferred shell is the one configured in Settings.

### Opening a terminal

Click a workspace in the sidebar. The terminal panel opens with one default tab.

### Managing tabs

| Action | How |
|--------|-----|
| New tab | Click **+ New Tab** or select a shell from the shell picker dropdown |
| Switch tab | Click the tab title |
| Rename tab | Double-click the tab title |
| Close tab | Click **×** on the tab |

### Using the terminal

The terminal is a fully functional PTY — paste, arrow keys, Ctrl+C, colors, all work normally. Type your agent's launch command and press Enter to start it.

### Navigating away

Switching to the **right panel** (Workspace ↔ Conductor tabs) or clicking nav items does **not** close the terminals — they keep running. Switching to **Grid mode** (clicking Overview in the nav) unmounts the terminal panel; your agent processes keep running in the OS but the sessions are cleared. Reopen the workspace to get fresh terminal sessions.

---

## 7. The Conductor — Full Walkthrough

The Conductor is **embedded in the workspace console view** as a right-panel tab. Every workspace has its own Conductor with its own set of plans — there's no shared global plan list.

**Two ways to open the Conductor:**
- Click your workspace in the sidebar → click the **[Conductor]** tab in the right panel.
- Click **Conductor** in the sidebar nav — if a workspace is open, it activates the Conductor tab directly.

```
┌────────────────────────────┬────────────────────────────────────────┐
│   Terminal Tabs            │  [Workspace]     [Conductor] ← active  │
│                            ├────────────────────────────────────────┤
│   (active terminal)        │  🌐 [Plan goal dropdown ▼] [📖] [+]    │
│                            ├──────────┬───────────┬─────────────────┤
│   (terminal content)       │  Build   │ Pipeline  │ History         │
│                            ├──────────┴───────────┴─────────────────┤
│                            │  <tab content>                         │
└────────────────────────────┴────────────────────────────────────────┘
```

The **plan selector** at the top lists plans for this workspace only. The **three tabs** below handle creation, live monitoring, and history:

| Tab | Purpose |
|-----|---------|
| **Build** | Create or edit the plan. Wire dependencies. Generate with an agent. |
| **Pipeline** | Live execution view — waves, task cards, log, manual override. |
| **History** | Completed and failed plans with full task detail. |

---

### Step 1: Set up terminal sessions

1. Click your workspace in the sidebar to open the console view.
2. Open terminal tabs and launch your agents in each one.
3. Name your terminal tabs descriptively (e.g. "claude-frontend", "antigravity-tests") so they are easy to assign.
4. If using spaces, make sure the terminals you want to coordinate are grouped in the active space.

---

### Step 2: Build a Plan

1. In the Conductor tab, click **+** (top right of the plan selector row) to create a new plan.
2. Fill in the **Plan Goal** — a plain-English description of what you want to accomplish overall.
3. Click **+ Add Task** for each task in your plan. Per task:
   - **Title** — short name (e.g. `Set up database schema`)
   - **Description** — the full instructions sent verbatim to the agent. Be specific and complete — this is exactly what the agent receives in its terminal.
   - **Assign to session** — pick which terminal session handles this task.
   - **Depends on** — check any tasks that must finish before this one starts. Leave unchecked for tasks that can run immediately (Wave 1).

4. Click **Save Draft** to save without running.

**Dependency example:**

```
Task A (no deps)  ──┐
                    ├──► Task C (depends on A and B)  ──► Task D
Task B (no deps)  ──┘
```

Tasks A and B run in parallel (Wave 1). Task C waits for both to finish (Wave 2). Task D waits for C (Wave 3).

---

### Step 3: Generate a Plan with an Agent

Instead of building tasks manually, you can ask a capable agent to write the plan for you.

1. Set the **Plan Goal** in the Plan Builder.
2. Scroll to **Generate Plan with Agent** and select a session from the dropdown.
3. The prompt is auto-filled with your goal, all registered sessions (with their real IDs), and the exact JSON format required.
4. Click **Generate** — Orchaterm sends the prompt to that terminal and watches for the response.

When the agent outputs the plan JSON wrapped in the sentinel markers:
```
###ORCHATERM_PLAN_START###
[...JSON array...]
###ORCHATERM_PLAN_END###
```

Orchaterm automatically validates it and populates the task list. You can then review, edit, and approve.

- **Copy Prompt** — copies the prompt to clipboard so you can paste it manually.
- **Cancel** — stops watching for a response.

---

### Step 4: Approve & Run

Once your plan is ready:

1. Confirm the session assignments are filled in.
2. Click **Approve & Run** (or press `Ctrl+Enter` / `Cmd+Enter`).

Orchaterm will:
1. Validate the plan (all tasks have titles and assigned sessions).
2. Lock it from further editing.
3. Switch to the **Pipeline tab** automatically.
4. Dispatch the first wave — inject each task's description + sentinel instructions into the assigned terminal.
5. Watch for sentinel completion signals.
6. When a task completes, relay its output to the next agent via Ollama and dispatch the next wave.
7. Pipeline board updates in real time.
8. Plan completes when all tasks are done.

---

### Step 5: Monitor the Pipeline

The **Pipeline tab** shows all tasks grouped into waves:

```
Wave 1              Wave 2              Wave 3
──────────          ──────────          ──────────
✅ Task A ─────────► 🔄 Task C ─────────► ⏳ Task D
✅ Task B ─────────►
```

**Task card colors:**
- **Grey** — pending (waiting for dependencies)
- **Orange** — running (agent is working)
- **Green** — done (sentinel detected)
- **Red** — failed (timeout or manual fail)

Click any task card to expand it and see output summary, files modified, and timing.

**Progress bar** at the top fills green as tasks complete. It turns red if any task fails.

**Run controls** (top-right of the tab bar when a plan is active):

| Control | Shortcut | What it does |
|---------|----------|--------------|
| **Pause** | `P` | Stops dispatching new tasks. Running tasks continue until done. |
| **Resume** | `R` | Re-enables dispatch. Pending tasks whose deps are resolved get dispatched. |
| **Stop** | `S` | Cancels all timers and marks running tasks failed. Does NOT kill agent processes. |
| **Clear** | — | After a plan finishes, removes it from the Pipeline view (history is kept). |

---

## 8. Manual Override

During a run, the **Manual Override** panel appears on the right side of the Pipeline tab.

### Inject a message into a session

1. Pick a session from the **Session** dropdown.
2. Type your message in the text box.
3. Click **Send** or press `Ctrl+Enter`.

The text is written directly to that terminal — as if you typed it yourself. Use this to answer agent questions, provide clarification, or give extra context mid-task.

### Override a task

Pick a task from the **Task** dropdown (only running or pending tasks are listed):

| Button | What it does |
|--------|--------------|
| **Force Done** | Marks the task complete immediately. Dependent tasks get dispatched on the next cycle. No output is collected — the handoff brief will be minimal. |
| **Fail** | Marks the task failed. Tasks that depend on it become blocked. If nothing else can run, the plan transitions to `failed`. |
| **Retry** | Resets a failed task back to `pending`. The engine re-dispatches it — the full task description + sentinel instructions are re-injected into the terminal. |

---

## 9. Orchestrator Log

The **Orchestrator Log** (left side of the Pipeline tab) shows a real-time chronological feed of every engine event.

| Badge | Color | Meaning |
|-------|-------|---------|
| `DISPATCH` | Orange | A task was sent to a terminal |
| `SENTINEL` | Green | An agent output the completion signal |
| `RELAY` | Purple | Ollama processed the output and wrote a brief |
| `TIMEOUT` | Yellow | A task exceeded its time limit |
| `ERROR` | Red | An internal error (e.g. Ollama offline, bad JSON) |
| `INFO` | Grey | General engine state changes (start, pause, stop) |
| `OVERRIDE` | Pink | A manual override action was taken |

The log auto-scrolls to the latest entry. Scroll up to read history.

---

## 10. History Tab

The **History tab** shows all plans that reached a terminal state (`done` or `failed`). Plans are stored in `orchaterm_plans.json` on disk and survive restarts.

Each plan card shows:
- Goal text and final status
- Task completion count (e.g. `4/5`)
- Total duration
- Date

Click a card to **expand** it and see every task with its output summary, files modified, and timestamps.

---

## 11. Settings Reference

Click **Settings** in the sidebar.

### Integration Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Terminal Shell Executable | `powershell.exe` | Shell used to open new terminal tabs. |
| Ollama API Host | `http://localhost:11434` | URL where Ollama is listening. |
| OpenAI API Key | — | Stored locally, never sent to any external server by Orchaterm. |
| Anthropic API Key | — | Same. |

### Conductor Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Ollama Relay Model | `llama3.2` | The model used to generate handoff briefs between agents. |
| Task Timeout (minutes) | 30 | How long a task can run before being auto-failed. |

### Theme

Click the 🌙 / ☀ button in the sidebar footer to toggle between dark and light mode. The preference is saved automatically.

### Export / Import

- **Export** — downloads all your workspaces, prompts, and logs as a JSON file. API keys are stripped.
- **Import** — loads a previously exported JSON file and replaces all current data.

---

## 12. Sentinel Protocol Reference

Orchaterm **automatically appends sentinel instructions** to every task prompt — you don't need to explain this to your agents manually.

For **persistent setups** (e.g. a `CLAUDE.md` that stays in your project), you can bake the instructions in permanently:

1. Open the workspace console view → **[Conductor]** tab.
2. Click the **📖 icon** in the plan selector row.
3. The Protocol Instructions modal opens with the full Markdown content.
4. Click **Copy to Clipboard** — paste into your `CLAUDE.md`.
5. Or click **Download as CLAUDE.md** — saves the file directly.

### Sentinel block format (what the agent must output)

```
###ORCHATERM_DONE###
task_id: <exact task ID from the prompt>
summary: [2-3 sentences: what you built, what changed, key decisions]
files_modified: [comma-separated file paths, or "none"]
needs: [what the next agent needs to know, or "none"]
###ORCHATERM_END###
```

### Field descriptions

| Field | Required | Notes |
|-------|----------|-------|
| `task_id` | Yes | Must match the ID in the task prompt exactly. Orchaterm uses this to route completion to the right task. |
| `summary` | Yes | Read by Ollama to generate the brief for the next agent. Be specific and factual. |
| `files_modified` | Yes | Comma-separated paths (relative or absolute), or `none`. |
| `needs` | Yes | What context the next agent requires. |

### Plan generation format (for the "Generate with Agent" feature)

```
###ORCHATERM_PLAN_START###
[
  {
    "id": "task-1",
    "title": "Short task name",
    "description": "Full instructions for this task",
    "assignedSessionId": "<session-id-from-the-prompt>",
    "dependsOn": []
  },
  {
    "id": "task-2",
    "title": "Second task",
    "description": "Full instructions",
    "assignedSessionId": "<session-id>",
    "dependsOn": ["task-1"]
  }
]
###ORCHATERM_PLAN_END###
```

---

## 13. Keyboard Shortcuts

### Standalone Conductor page (`/conductor`)

| Key | Action | Condition |
|-----|--------|-----------|
| `P` | Pause the running pipeline | Not typing in an input field |
| `R` | Resume a paused pipeline | Not typing in an input field |
| `S` | Stop the running pipeline | Not typing in an input field |
| `Esc` | Close the Protocol Instructions modal | Modal is open |

---

## 14. Troubleshooting

### Sessions not showing in the Conductor

**Cause:** No terminal tabs are open yet for this workspace.

**Fix:**
1. Click your workspace in the sidebar to open the console view.
2. Open terminal tabs and launch your agents.
3. Sessions will be populated in the Conductor.

---

### Sentinel not detected (task stays "Running" until timeout)

**Symptom:** The task runs forever, then gets auto-failed with a `TIMEOUT` log entry.

**Check:**
1. Did the agent actually output `###ORCHATERM_DONE###`? Scroll up in the terminal to check.
2. Is there extra text or whitespace before the marker? It must appear on its own line.

**Fix:**
- Use **Force Done** in Manual Override if the work is actually complete.
- Use **Retry** to re-dispatch if the agent got stuck.
- Add the CLAUDE.md protocol file to your project directory.

---

### Ollama relay fails or shows ERROR in the log

**Symptom:** Log shows a red `ERROR` entry; tasks complete but the next agent receives a minimal brief.

**Fix:** Orchaterm falls back to pass-through automatically — the task's `summary` and `needs` fields are concatenated and sent directly as the brief.

---

### Plan generation returns malformed JSON

**Symptom:** After clicking Generate, the plan task list stays empty or shows a red error banner.

**Check:**
1. Did the agent output extra text before or after the `###ORCHATERM_PLAN_START###` / `###ORCHATERM_PLAN_END###` markers?
2. Is the JSON valid?

**Fix:**
- Edit the generated plan in the Plan Builder task list manually.
- Or click **Generate again.

---

*Orchaterm v0.1.0 (Beta) — Built to make multi-agent collaboration actually work.*
