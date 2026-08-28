# Session Continuation & Checkpoint Workflow

This document explains Orchaterm's continuous checkpointing architecture for seamless context migration between terminal sessions.

---

## 1. Overview

When working with terminal-based coding agents or long-running development scripts, maintaining context across sessions is essential. Orchaterm provides an automated background monitoring, checkpoint generation, and prompt injection pipeline.

```mermaid
graph TD
    A[Terminal Session (e.g. CLI Agent)] -->|PTY Output Stream| B(BufferWatcher)
    B -->|Rolling Memory Buffer| C{Trigger Checkpoint}
    C -->|Manual UI: Tab Context Menu| D[generateCheckpoint]
    C -->|Auto-Detect: Stalled or Rate-Limit| D
    D -->|Read Previous Checkpoint Summary| E[Rolling Context Chain]
    E -->|Combine Buffer Tail + Prev Summary| F[LLM Summarization]
    F -->|Write Markdown File| G[.orchaterm/checkpoints/]
    G -->|Trigger UI Modal| H[Continuation Modal]
    H -->|Select Target Session| I[Inject Resume Prompt]
```

---

## 2. Checkpoints vs. Periodic Snapshots

* **Handoff Checkpoint:** Generated when you click **"Create Checkpoint Now"** on a tab context menu, or automatically when an active task hits a limit. It captures the final state to prepare for tab migration.
* **Periodic Snapshot (Autosave):** Generated in the background while commands are running (by default every `4,000` characters of output).

---

## 3. The Rolling Context Chain

To prevent context amnesia:
1. Before writing checkpoint #N, Orchaterm reads the narrative summary of checkpoint #(N-1).
2. It feeds that previous summary to the LLM alongside the new terminal buffer logs.
3. The LLM merges the past summary with the recent work, writing a cumulative story.
4. Early session progress is never lost, even after raw terminal logs rotate out of the buffer.
