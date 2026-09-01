# Orchaterm Architecture Guide

Orchaterm is a next-generation terminal built for the AI era of software development. It combines high-performance GPU-accelerated terminal emulation with an ambient, non-intrusive orchestration layer.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ORCHATERM DESKTOP                              │
│                                                                             │
│  ┌─────────────────────────┐  ┌──────────────────────────────────────────┐  │
│  │   Terminal Panel (PTY)  │  │          Workspace Sidecar Panel         │  │
│  │                         │  │                                          │  │
│  │  • xterm.js + WebGL     │  │  • Ambient Chat & Relay Stream           │  │
│  │  • Split grids & tabs   │  │  • Visual Task Pipelines (DAG)           │  │
│  │  • Custom keybindings   │  │  • Live Task Boards & Templates          │  │
│  │  • Sentinel detection   │  │  • Checkpoint & Session Continuation     │  │
│  └───────────┬─────────────┘  └───────────────────┬──────────────────────┘  │
│              │                                    │                         │
│              ▼                                    ▼                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                   Rust Backend (Tauri v2 Core)                        │  │
│  │                                                                       │  │
│  │  • portable-pty process spawning (PowerShell / Bash / Zsh)            │  │
│  │  • Non-blocking UTF-8 buffer drainer                                  │  │
│  │  • OS IPC commands & high-speed event streaming                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      │                                      │
│                                      ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                   Ambient Coordination Layer                          │  │
│  │                                                                       │  │
│  │  • Offline Local LLMs: Ollama / LM Studio (qwen2.5, llama3.2, etc.)   │  │
│  │  • Optional Cloud LLMs: Anthropic Claude / Google Gemini              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Subsystems

### A. High-Performance Terminal Engine (`src-tauri` + `@xterm/xterm`)
- **PTY Management**: Managed via `portable-pty` in Rust, creating true OS pseudoterminals.
- **Rendering**: `@xterm/addon-webgl` for 60fps rendering, with graceful canvas fallback.
- **Terminal Grids**: Tree-based split view supporting horizontal and vertical splits, active tab reordering, and independent PTY resizing.

### B. Ambient Intelligence & Sentinel Protocol (`src/services/`)
- **Buffer Watcher**: Retains a rolling buffer tail per session to detect status changes without intercepting or breaking native interactive CLI sessions.
- **Sentinel Parsing**: Structured markers (`###ORCHATERM_DONE###`, `###ORCHATERM_NEEDS###`) allow CLI agents or scripts to cleanly emit task summaries and next-step requirements.
- **Shared Blackboard**: The orchestrator rewrites `.orchaterm/ORCHATERM_BOARD.md` in the workspace after every task state change; each dispatch prompt tells the agent to read it first, so the whole team coordinates through one inspectable artifact instead of pairwise briefs alone.
- **Verification Receipts**: Each task may declare a `verify` shell command; after completion the engine runs it in a short-lived hidden PTY (never in the agent's own terminal) and records pass/fail on the task, the blackboard, and the agent's reputation.
- **Auto-Replan**: When a failed task blocks the whole DAG, the planner is asked for 1-2 replacement tasks which are spliced into the graph (downstream tasks are re-pointed) before the plan is declared failed. Capped at one replan per run.
- **User Gates**: A task may carry `askUser` instead of terminal work — the pipeline pauses, the question appears in the Space chat with an inline answer box, and the answer flows to downstream tasks as the gate's handoff.
- **Agent Reputation**: Every completion, failure, timeout and verification is recorded per terminal (persisted in localStorage); the Live board shows trust chips per agent.
- **Rewind & Replay**: On a failed/stopped plan, "Retry from failed" resets the failed task and its transitive dependents while keeping completed results; completed tasks' captured output can be replayed in a speed-adjustable viewer from the Live board and History.
- **Soft Completion (idle fallback)**: When a dispatched task's terminal returns to its prompt and goes quiet without printing the sentinel block, a small judge model evaluates the terminal output against the task's goal and can complete the task with a synthesized summary — so non-compliant agents and plain shell commands finish pipelines instead of hanging. Echo suppression is content-anchored on the dispatched prompt's tail: the moment the echo completes, detection starts, so output from instant commands is never lost to a fixed time window.
- **Autonomous Relay**: When a task completes in one session, the ambient LLM summarizes output and injects context into dependent sessions.

### C. Visual Task Pipelines (`src/components/pipeline/`)
- **Dependency Graphs (DAG)**: Build task dependency trees with sequential or parallel execution waves.
- **Live Board & Manual Override**: Monitor execution across all active sessions with live task cards, real-time logs, and manual intervention controls (Force Done, Retry, Fail).
- **Reusable Templates**: Save common multi-session workflows as templates.

### D. Continuous Session Checkpointing (`src/services/sessionContinuationService.ts`)
- **Autosave Snapshots**: Automatically snapshot session memory every 4,000 characters of terminal output.
- **Context Handoffs**: When an agent session approaches rate limits or context windows, Orchaterm creates a structured Markdown checkpoint enabling seamless continuation in a new session.

---

## 3. Supported LLM Providers

Orchaterm includes a unified multi-provider client factory supporting:
1. **Ollama**: Local, zero-cost, offline orchestration (`/api/chat` and `/api/tags`).
2. **OpenAI-Compatible / LM Studio**: Standard `/v1/chat/completions` API.
3. **Anthropic Claude**: High-reasoning cloud orchestration.
4. **Google Gemini**: High-speed, large-context cloud orchestration.
