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
- **Shared Blackboard**: The orchestrator rewrites `ORCHATERM_BOARD.md` at the workspace root after every task state change; each dispatch prompt tells the agent to read it first, so the whole team coordinates through one inspectable artifact instead of pairwise briefs alone.
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
