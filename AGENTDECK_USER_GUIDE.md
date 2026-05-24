# AgentDeck — User Guide

> **Version:** 0.1.0 (Beta)  
> **Platform:** Windows / macOS / Linux (Tauri desktop app)

---

## Table of Contents

1. [What is AgentDeck?](#1-what-is-agentdeck)
2. [Key Concepts](#2-key-concepts)
3. [First-Time Setup](#3-first-time-setup)
4. [Workspaces](#4-workspaces)
5. [Agent Registry](#5-agent-registry)
6. [The Terminal (Working with Agents)](#6-the-terminal-working-with-agents)
7. [The Conductor — Overview](#7-the-conductor--overview)
8. [Session Registry — Mapping Terminals to Agents](#8-session-registry--mapping-terminals-to-agents)
9. [Plan Builder — Creating a Task Plan](#9-plan-builder--creating-a-task-plan)
10. [Generate Plan with Agent](#10-generate-plan-with-agent)
11. [Running the Pipeline](#11-running-the-pipeline)
12. [Manual Override](#12-manual-override)
13. [Orchestrator Log](#13-orchestrator-log)
14. [History Tab](#14-history-tab)
15. [Settings](#15-settings)
16. [Sentinel Protocol Reference](#16-sentinel-protocol-reference)
17. [Keyboard Shortcuts](#17-keyboard-shortcuts)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. What is AgentDeck?

AgentDeck solves a real problem: when you run multiple AI coding agents (Claude Code, Antigravity, Hermes, or multiple sessions of the same agent) in separate terminals, they have **no awareness of each other**. They can't share context, they don't know when one finishes, and you have to manually copy outputs between them.

AgentDeck acts as the **orchestration layer** between your agents:

- Each agent runs in its **own real terminal session** — exactly as you'd use it normally.
- You define a **task plan** with dependencies (e.g. Agent A must finish before Agent B starts).
- When Agent A finishes a task, it outputs a structured **sentinel signal**. AgentDeck detects this automatically.
- A local **Ollama model** (small, fast) reads the output and writes a concise brief for Agent B.
- AgentDeck dispatches Agent B's task automatically, injecting the brief as context.

You watch it all happen in the **Pipeline board**, with a live log, and can intervene at any time via **Manual Override**.

---

## 2. Key Concepts

| Term | What it means |
|------|---------------|
| **Workspace** | A project directory you're working on. Keeps your agents, logs, and prompts organized. |
| **Agent** | A registered AI tool (Claude Code, Antigravity, etc.) with a name, color, and launch command. |
| **Terminal Session** | A real PTY terminal opened inside AgentDeck. Each session runs one agent. |
| **Session Registry** | The mapping between terminal sessions and agents. Required before running the Conductor. |
| **Plan** | A directed acyclic graph (DAG) of tasks, each assigned to a session/agent, with optional dependencies. |
| **Wave** | A group of tasks that can all run at the same time (all their dependencies are resolved). |
| **Sentinel** | A structured block agents output when they complete a task. AgentDeck detects it automatically. |
| **Ollama Relay** | A local small LLM that reads one agent's output and writes a brief for the next agent. Falls back to pass-through if Ollama is offline. |
| **Conductor** | The main orchestration UI where you build plans, run pipelines, and monitor progress. |

---

## 3. First-Time Setup

### Step 1 — Install Ollama (recommended)

AgentDeck uses a local Ollama model as the relay between agents. Without it, task outputs are passed verbatim (still works, just less refined).

```
# Install from https://ollama.com
ollama pull llama3.2        # fast, good quality
# or
ollama pull mistral         # alternative
```

Leave Ollama running in the background (`ollama serve`).

### Step 2 — Configure Settings

Open **Settings** (bottom of the sidebar):

1. **Terminal Shell Executable** — Set to your preferred shell:
   - Windows: `powershell.exe` or `cmd.exe`
   - WSL/Mac/Linux: `bash` or `zsh`

2. **Ollama API Host** — Default is `http://localhost:11434`. Change only if Ollama runs on a different port.

3. **Conductor Settings** — Click **Refresh** next to "Ollama Relay Model" to load your installed models. Pick a small/fast one (e.g. `llama3.2:latest`). Set a task timeout (default 30 minutes).

4. Click **Save Integration Settings** and **Save Conductor Settings**.

### Step 3 — Create a Workspace

Click **+** on the Workspaces section in the sidebar, or go to **Settings → Workspaces** and create one with your project name and directory path.

### Step 4 — Register Your Agents

Go to **Settings → Agent Registry → +** and add each AI tool you use:

- **Claude Code**: Type = `terminal`, Launch Command = `claude`
- **Antigravity**: Type = `terminal`, Launch Command = `antigravity`  
- **Multiple Claude Code sessions**: Register each as a separate agent with a distinct name and color (e.g. "Claude A" in blue, "Claude B" in green).

---

## 4. Workspaces

Workspaces are the top-level containers for your projects. Each workspace has:

- A **name** and **local path** (the directory Claude Code or other agents will work in)
- A **color** for visual identification
- A **status** (Active / Paused / Idle)
- An optional **default agent** assignment

Click a workspace in the sidebar to open its **Dashboard view**, where you can open terminals, see running agents, and navigate to the Conductor.

---

## 5. Agent Registry

The Agent Registry (Settings → Agents tab) stores information about the AI tools you use. Each entry has:

- **Name** — displayed throughout the UI (e.g. "Claude Code")
- **Type** — `terminal` for CLI tools, `web` for browser-based tools
- **Launch Command** — the terminal command to start the agent (e.g. `claude --dangerously-skip-permissions`)
- **Color** — used for visual tagging in the pipeline board and session registry
- **Best Used For** — descriptive text (shown in tooltips)

Agents in the registry are available for assignment in the Session Registry and displayed in all plan-related views.

---

## 6. The Terminal (Working with Agents)

Each workspace has a built-in terminal panel. You can open multiple terminal tabs, each running a separate agent session.

### Opening terminals

1. Open a workspace from the sidebar.
2. Switch to **Console view** (the terminal panel appears).
3. Click **+** to open a new terminal tab.
4. Inside the terminal, launch your agent (e.g. type `claude` and press Enter for Claude Code).

### Tab management

- **Rename** a tab by double-clicking its name.
- **Close** a tab with the × button.
- Each terminal is a fully functional PTY — paste, arrow keys, Ctrl+C, everything works normally.

> **Important:** Terminal sessions are **ephemeral** — they reset each time you restart AgentDeck. You must open your agent terminals before using the Conductor.

---

## 7. The Conductor — Overview

Click **Conductor** in the sidebar to enter the orchestration interface.

The Conductor has three areas:

| Area | What it does |
|------|-------------|
| **Left sidebar** | Lists your plans. + creates a new plan. 📖 opens the Protocol Instructions. |
| **Plan Builder tab** | Create and edit task plans. Wire dependencies. Generate plans using a capable agent. |
| **Pipeline tab** | Real-time pipeline view. Waves of parallel tasks, live status, SVG dependency arrows. |
| **History tab** | Completed and failed plans with full task detail and output summaries. |

---

## 8. Session Registry — Mapping Terminals to Agents

Before you can run a plan, AgentDeck needs to know **which terminal session contains which agent**.

At the top of the Plan Builder, you'll see the **Session Registry**:

```
┌─────────────────────────────────────────────────────────────┐
│ 🔗 SESSION REGISTRY   Assign each terminal to its agent     │
├──────────────────────────────────┬──────────────────────────┤
│ ● Terminal 1                     │  [Claude Code A    ▼]    │
│ ● Terminal 2                     │  [Claude Code B    ▼]    │
│ ● Terminal 3                     │  [— Unassigned —   ▼]    │
└──────────────────────────────────┴──────────────────────────┘
```

1. For each open terminal session, select the agent that's running in it from the dropdown.
2. Sessions without an assignment will not receive tasks.
3. You can reassign sessions at any time (changes take effect on the next task dispatch).

> **Tip:** The colored dot next to a session name shows the assigned agent's color once selected.

---

## 9. Plan Builder — Creating a Task Plan

### Manual plan creation

1. Click **+** in the Conductor sidebar to create a new plan.
2. Fill in the **Plan Goal** — a plain-English description of what you want to achieve overall.
3. Add tasks using **+ Add Task**. For each task:
   - **Title** — short name (e.g. "Set up database schema")
   - **Description** — full instructions the agent will receive. Be specific — this is exactly what gets sent to the agent's terminal.
   - **Assign to session** — pick which terminal (and therefore which agent) handles this task.
   - **Depends on** — check any tasks that must complete before this one starts. Tasks with no dependencies run in the first wave.

4. Review the dependency checkboxes carefully — circular dependencies will prevent dispatch.

5. Click **Save Draft** to save without running, or **Approve & Run** (or `Ctrl+Enter`) to approve and immediately start the pipeline.

### Understanding waves

Tasks are automatically grouped into **waves** in the Pipeline view:

- **Wave 1**: tasks with no dependencies (run immediately in parallel)
- **Wave 2**: tasks that only depend on Wave 1 tasks (start when their specific dep is done)
- **Wave N**: and so on...

Tasks in the same wave can run simultaneously on different sessions. Tasks in the same wave assigned to the same session run sequentially (that session finishes one before starting the next).

---

## 10. Generate Plan with Agent

Instead of manually creating tasks, you can ask a capable agent (Claude Code, etc.) to write the plan for you.

### How it works

1. Set your **Plan Goal** in the Plan Builder.
2. In the **Generate Plan with Agent** section, pick a session from the dropdown.
3. The prompt textarea is auto-filled with a complete instruction that includes:
   - Your goal
   - A list of all registered sessions with their real IDs
   - The exact JSON format required
   - The sentinel markers the agent must wrap the output in
4. Edit the prompt if needed, then click **Generate**.

AgentDeck sends the prompt to the agent's terminal and watches for the plan JSON wrapped in:
```
###AGENTDECK_PLAN_START###
[...JSON array...]
###AGENTDECK_PLAN_END###
```

When the agent outputs this block, AgentDeck automatically:
- Validates the JSON structure
- Maps session IDs to agents
- Populates the task list in the Plan Builder

You can then review, edit, and approve the generated plan.

**Copy prompt** — copies the prompt to clipboard so you can paste it manually if preferred.  
**Cancel** — stops watching for the plan response (clears the buffer watcher).

> **Note:** Use a capable agent for plan generation (Claude Code, not the Ollama relay model). The Ollama relay is only used for handoffs during execution.

---

## 11. Running the Pipeline

### Starting a run

1. Complete the Session Registry (all sessions mapped to agents).
2. Build or generate a plan in the Plan Builder.
3. Click **Approve & Run** (or `Ctrl+Enter`).

AgentDeck will:
1. Lock the plan (no more editing)
2. Switch to the Pipeline tab automatically
3. Dispatch the first wave of tasks — injecting each task's description + sentinel instructions into the agent's terminal
4. Watch the terminal buffers for the sentinel completion signal
5. When a task completes, relay the output to the next agent via Ollama and dispatch the next wave

### Pipeline tab

```
Wave 1        →        Wave 2        →        Wave 3
──────────             ──────────             ──────────
[DONE] Task A ────────►[RUNNING] C  ────────►[PENDING] E
[DONE] Task B ────────►[DONE]    D
```

- **Color-coded wave headers**: grey (pending), orange (running), green (done), red (failed)
- **SVG arrows**: solid arrows = source task is done; dashed = source still running or pending
- **Task cards**: click to expand and see output summary, files modified, timing

### Progress bar

The summary bar at the top of the Pipeline tab fills green as tasks complete. It turns red if any task fails.

### Pause / Resume / Stop

| Button | Shortcut | Effect |
|--------|----------|--------|
| **Pause** | `P` | Stops dispatching new tasks. Currently running tasks continue until they finish or time out. |
| **Resume** | `R` | Re-enables the dispatcher. Any tasks whose deps are now resolved get dispatched. |
| **Stop** | `S` | Immediately cancels all timeout timers. Does NOT kill the agent processes — the terminals keep running. |
| **Clear** | — | After a plan finishes, removes it from the Pipeline view (does not delete from history). |

---

## 12. Manual Override

During a run, the **Manual Override** panel (right side of the Pipeline tab) lets you intervene without stopping the whole pipeline.

### Inject message into session

Pick a session from the dropdown and type a message. Click **Send** or press `Ctrl+Enter` inside the message box. The text is written directly to that terminal — as if you typed it.

Use this to:
- Answer an agent's question
- Provide clarification mid-task
- Give additional context

### Task override controls

Pick a task from the dropdown (only running or pending tasks are listed):

| Button | Effect |
|--------|--------|
| **Force Done** | Marks the task as complete immediately. The engine treats it as successful and dispatches dependents. No output is collected — the next agent gets no brief (or the existing output if any was captured). |
| **Fail** | Marks the task as failed. All tasks that depend on it become blocked. The plan status changes to `failed` if no other tasks can run. |
| **Retry** | Resets a failed task back to `pending`. The dispatcher will re-dispatch it on the next cycle. The task description + sentinel instructions are re-injected into the terminal. |

---

## 13. Orchestrator Log

The Orchestrator Log (left side of the Pipeline tab) shows a real-time chronological feed of all engine events.

### Log entry types

| Badge | Color | Meaning |
|-------|-------|---------|
| `DISPATCH` | Orange | A task was sent to a terminal session |
| `SENTINEL` | Green | An agent output the completion signal |
| `RELAY` | Purple | Ollama processed the output and generated a brief |
| `TIMEOUT` | Yellow | A task exceeded its timeout limit |
| `ERROR` | Red | An internal error (Ollama offline, bad JSON, etc.) |
| `INFO` | Grey | General engine state changes |
| `OVERRIDE` | Pink | A manual override action was taken |

The log auto-scrolls to the bottom. Scroll up to read history — it won't snap back while you're reading.

---

## 14. History Tab

The History tab shows all plans that have reached a terminal state (`done` or `failed`).

Each plan card shows:
- **Goal** and final **status**
- **Task completion count** (e.g. 4/5 tasks)
- **Duration** (from plan start to completion)
- **Date**

Click any plan card to **expand** it and see:
- Every task in the plan with its final status
- Output summaries from the sentinel blocks
- Files modified by each agent
- Timing (started, completed)

History is persisted to disk in `agentdeck_plans.json` and survives app restarts.

---

## 15. Settings

### General tab

| Setting | Description |
|---------|-------------|
| **Theme** | Dark (default) or Light |
| **Export / Import** | Backup and restore all workspaces, agents, prompts, and logs as JSON |
| **Terminal Shell** | Path to your shell executable |
| **Ollama API Host** | URL where Ollama is listening (default: `http://localhost:11434`) |
| **API Keys** | OpenAI and Anthropic keys (stored locally, not transmitted to any server) |

### Conductor section

| Setting | Description |
|---------|-------------|
| **Ollama Relay Model** | The model used to relay context between agents. Click **Refresh** to load your installed models. Recommended: `llama3.2` or `mistral`. |
| **Task Timeout (minutes)** | How long a task can run before being auto-failed. Default: 30 minutes. |

### Workspaces tab

Edit or delete existing workspaces. Change name, path, color, status, or default agent assignment.

### Agent Registry tab

Edit or delete registered agents. Change name, type, launch command, color, and description.

---

## 16. Sentinel Protocol Reference

Agents must output a specific block when they complete a task. AgentDeck **automatically appends these instructions** to every task prompt — you don't need to explain this to agents manually.

However, for persistent agent setups (e.g. Claude Code with a `CLAUDE.md`), you can bake the instructions in permanently:

**In the Conductor sidebar**, click the 📖 icon to open the Protocol Instructions modal. Click:
- **Copy to Clipboard** — paste into your terminal or CLAUDE.md
- **Download as CLAUDE.md** — saves the file for use in your project directory

### Sentinel block format

```
###AGENTDECK_DONE###
task_id: <exact task ID from prompt>
summary: [2-3 sentences describing what you built and key decisions]
files_modified: [comma-separated file paths, or "none"]
needs: [what the next agent needs to know, or "none"]
###AGENTDECK_END###
```

### Field descriptions

| Field | Required | Notes |
|-------|----------|-------|
| `task_id` | Yes | Must exactly match the ID in the task prompt. Used to route the completion to the right task. |
| `summary` | Yes | Read by Ollama to generate the brief for the next agent. Be specific. |
| `files_modified` | Yes | Helps the next agent know what was changed. Comma-separated paths or `"none"`. |
| `needs` | Yes | What context the next agent requires. Ollama uses this to write the handoff brief. |

### Plan generation format (optional)

When an agent is asked to generate a plan:

```
###AGENTDECK_PLAN_START###
[
  {
    "id": "unique-string",
    "title": "Task name",
    "description": "Full task instructions",
    "assignedSessionId": "session-id-from-prompt",
    "dependsOn": []
  }
]
###AGENTDECK_PLAN_END###
```

---

## 17. Keyboard Shortcuts

### Global (Conductor)

| Shortcut | Action | Condition |
|----------|--------|-----------|
| `P` | Pause orchestration | Not in text input |
| `R` | Resume orchestration | Not in text input |
| `S` | Stop orchestration | Not in text input |
| `Esc` | Close protocol modal | Modal is open |

### Plan Builder

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` / `Cmd+Enter` | Approve & Run (if plan is valid) |
| `Ctrl+Enter` (in Inject box) | Send injected message |

---

## 18. Troubleshooting

### Agent not receiving tasks

**Check:**
1. Is the terminal open and the agent running?
2. Is the session mapped in the Session Registry?
3. Is the session ID in the task's "Assign to session" field correct?

**Fix:** Close and reopen the terminal, re-launch the agent, remap in Session Registry.

---

### Sentinel not detected

**Symptom:** Task stays in "Running" forever, then times out.

**Check:**
1. Did the agent actually output `###AGENTDECK_DONE###`?
2. Is there a typo in the sentinel markers?
3. Did something interrupt the agent before it finished?

**Fix:** Use **Force Done** or **Retry** from the Manual Override panel. Add the CLAUDE.md protocol file to your project so the agent learns the format.

---

### Ollama relay fails

**Symptom:** Log shows `RELAY` error; tasks complete but next task gets no brief.

**Check:**
1. Is Ollama running? (`ollama serve`)
2. Is the Ollama host correct in Settings?
3. Is the selected model installed? (`ollama list`)

**Fix:** AgentDeck falls back to pass-through automatically — the task's `summary` and `needs` fields are used directly as the brief. The pipeline continues, just with less polished context.

---

### Task times out immediately

**Symptom:** Task is marked failed seconds after dispatch.

**Check:** The task timeout in Settings → Conductor Settings. Default is 30 minutes (1800 seconds). Some tasks may need longer.

**Fix:** Increase the timeout. Use **Retry** to re-dispatch the task.

---

### Plan generation returns malformed JSON

**Symptom:** After clicking Generate, the error banner shows "Plan JSON must be an array" or similar.

**Check:**
1. Did the agent output extra text before/after the markers?
2. Is the JSON array properly formatted?
3. Did the agent use session IDs that weren't in the prompt?

**Fix:** Edit the generated JSON manually in the task list, or prompt the agent again with more explicit instructions. The textarea showing the prompt is fully editable.

---

### Sessions disappear after restart

This is expected — terminal sessions are **ephemeral** (not persisted to disk). Re-open your agent terminals and re-map them in the Session Registry each time you launch AgentDeck.

---

### Nothing happens when I click "Approve & Run"

**Check:**
1. Are there validation errors shown in red? (missing title, no session assigned)
2. Does at least one session have an agent assigned in the Session Registry?
3. Is Ollama running if you have it configured?

**Fix:** Resolve all validation errors shown below the task list. Assign sessions. All tasks must have a title and an assigned session before the plan can run.

---

*AgentDeck v0.1.0 (Beta) — Built to make multi-agent collaboration actually work.*
