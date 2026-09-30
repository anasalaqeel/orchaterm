# Session Continuation & Checkpoint Workflow

This document explains Orchaterm's continuous checkpointing architecture for context migration between terminal sessions.

---

## 1. Overview

When working with terminal-based coding agents or long-running development scripts, maintaining context across sessions is essential. Orchaterm monitors agent output, generates checkpoints when a session stops (e.g. a usage limit), and lets **you** hand the work to another terminal — manually, always.

Detection is notification-only: when Orchaterm detects an agent has hit a limit or stopped, it writes a checkpoint file and shows a toast. Nothing is ever injected or launched automatically. Handover is a single explicit action.

```mermaid
graph TD
    A[Terminal Session (e.g. CLI Agent)] -->|PTY Output Stream| B(BufferWatcher)
    B -->|Rolling Memory Buffer| C{Trigger Checkpoint}
    C -->|Manual UI: Tab Context Menu| D[generateCheckpoint]
    C -->|Auto-Detect: Stalled or Rate-Limit → toast only| D
    D -->|Read Previous Checkpoint Summary| E[Rolling Context Chain]
    E -->|Combine Buffer Tail + Prev Summary| F[LLM Summarization]
    F -->|Write Markdown File| G[.orchaterm/checkpoints/]
    G -->|Manual action: Pass work / Inject Last Checkpoint| H[Handover Dialog]
    H -->|Select Target Session| I[Inject Resume Prompt]
```

---

## 2. Checkpoints vs. Periodic Snapshots

* **Handoff Checkpoint:** Generated when you click **"Create Checkpoint Now"** on a tab context menu, or automatically when detection classifies an agent as limited/stopped (notification only — the file is saved, you decide what happens next).
* **Periodic Snapshot (Autosave):** Generated in the background while commands are running (by default every `4,000` characters of output).

---

## 3. The Rolling Context Chain

To prevent context amnesia:
1. Before writing checkpoint #N, Orchaterm reads the narrative summary of checkpoint #(N-1).
2. It feeds that previous summary to the LLM alongside the new terminal buffer logs.
3. The LLM merges the past summary with the recent work, writing a cumulative story.
4. Early session progress is never lost, even after raw terminal logs rotate out of the buffer.

---

## 4. Handing Work to Another Terminal (Manual)

Typical scenario: Claude Code hits its usage limit and you want to continue with a different agent.

1. Open a new terminal tab and start whichever agent you want (`gemini`, `codex`, `aider`, another `claude`, …).
2. Right-click the stopped session's tab and choose **"Pass work to another terminal…"**. This captures a fresh checkpoint and opens the handover dialog.
3. Pick the target tab (including tabs in workspaces that aren't currently open — they are restored on demand) and click **"Pass & Resume"**.
4. Orchaterm waits until the target terminal's output settles (a freshly started agent TUI needs a moment to boot; injected text during boot would be swallowed), then injects the resume prompt pointing at the checkpoint file. The new agent reads the file and continues.

Related context-menu actions:
* **"Create Checkpoint Now"** — capture a checkpoint file only (no dialog).
* **"Inject Last Checkpoint..."** — inject the most recent checkpoint into a terminal you pick, without capturing a new one.

Because the handoff is a plain Markdown file on disk plus a resume prompt, it works across different agent CLIs — no shared session format required.
