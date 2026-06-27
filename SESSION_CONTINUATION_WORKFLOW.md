# Orchaterm — Session Continuation & Checkpoint Handoff Workflow

This document outlines the architecture, features, and user workflow for migrating active agent coding context (e.g., from Claude Code to Antigravity CLI) when facing rate limits, crashes, or shift-of-work scenarios.

---

## 1. Core Architecture Overview

When working with terminal-based coding agents, maintaining cognitive continuity (the plan, what has been edited, decisions made, and next steps) is critical. Orchaterm facilitates this through a background monitoring, checkpoint generation, and prompt injection pipeline.

```mermaid
graph TD
    A[Terminal Session (e.g., Claude Code)] -->|PTY Output stream| B(BufferWatcher)
    B -->|Capped 256 KB memory buffer| C{Trigger Checkpoint}
    C -->|Manual UI: Right-Click Tab| D[generateCheckpoint]
    C -->|Auto-Detect: Conductor Stalled/Rate-Limit| D
    D -->|Read Previous Checkpoint Summary| E[Rolling Context Chain]
    E -->|Combine Log Tail + Prev Summary| F[LLM Summarization]
    F -->|Write Markdown File| G[.orchaterm/checkpoints/]
    G -->|Trigger UI Modal| H[Continuation Modal]
    H -->|Select Target Tab e.g., Antigravity| I[Inject Resume Prompt]
    I -->|PTY Write Command| J[Target Session reads Checkpoint File]
```

---

## 2. Key Concepts & Features

### 📂 Checkpoints vs. Periodic Snapshots
* **Handoff Checkpoint:** Generated when you click **"Create Checkpoint Now"** on a tab context menu, or automatically when a Conductor task hits a limit or crashes. It captures the final state to prepare for tab migration.
* **Periodic Snapshot (Autosave):** Generated in the background while the agent is running (by default, every `4000` characters printed to the terminal). It provides historical backup points.

### ⛓️ The Rolling Context Chain
To prevent context amnesia, Orchaterm uses a **summary chain**:
1. Before writing checkpoint #5, the app reads the narrative summary of checkpoint #4.
2. It feeds that previous summary to the LLM alongside the new terminal buffer logs.
3. The LLM merges the past summary with the recent work, writing a cumulative story.
4. This ensures early session progress is never forgotten, even after the raw terminal logs have been rotated out of the memory buffer.

### 🧹 Automatic Cleanup & Rotation
To prevent checkpoints from cluttering your disk space, Orchaterm automatically cleans up the directory:
* Every time a new checkpoint is created, the app lists the `.orchaterm/checkpoints/` directory.
* It groups checkpoints by their tab name (session title) and deletes the oldest ones.
* It **retains only the 5 most recent checkpoints** per session.

### ⚡ Context Window Optimization
Processing massive terminal logs can freeze local LLMs. Orchaterm dynamically adjusts the size of the history sent to the LLM:
* **Local Models (Ollama):** Slices the terminal history to the most recent **20,000 characters** (approx. 4,000 tokens) for near-instant completion (under 10s).
* **Cloud Models (Claude, Gemini, OpenAI):** Slices history to the most recent **100,000 characters** (approx. 20,000 tokens) because cloud APIs handle large contexts instantly and write more detailed summaries.
* **Custom Limits:** Exposed as **"Checkpoint history sent to LLM (chars)"** in Settings.

---

## 3. Step-by-Step Handoff Workflow

### Step 1: Trigger the Checkpoint
If your session in **Terminal 1** (e.g., Claude Code) gets stuck, rate-limited, or you want to migrate:
1. Right-click the terminal tab label.
2. Click **"📷 Create Checkpoint Now"**.

### Step 2: Generation & Loading Feedback
1. A persistent loading toast pops up: **"Generating checkpoint and narrative summary..."** with a loading spinner.
2. The `SessionContinuationService` reads the terminal log buffer, extracts the previous checkpoint summary, calls Ollama/API to summarize, and writes a Markdown file into `.orchaterm/checkpoints/` in your workspace.

### Step 3: Choose Target Tab
1. Once saved, the loader toast changes to a green **"Checkpoint created successfully!"** success message.
2. The **Handoff Modal** pops up listing all other active terminals.
3. Select **Terminal 2** (e.g. your Antigravity tab) and click **"Inject & Resume"**.

### Step 4: Resume
1. Orchaterm types a prompt directly into the shell of Terminal 2:
   `Continue working on the following task... Checkpoint file: C:/.../.orchaterm/checkpoints/file.md. Please read the checkpoint file and continue...`
2. The agent in Terminal 2 uses its built-in file-reading tools to open the checkpoint, parses the narrative summary and files modified, and continues editing the codebase from where Terminal 1 stopped.

---

## 4. Best Practices for Users

> [!TIP]
> **Terminate Stale Sessions:** Once you have successfully migrated from Terminal 1 to Terminal 2, type `/exit` (or press `Ctrl+D`) in Terminal 1 to close its process. This prevents you from typing commands in the old terminal and avoids CPU/memory wastage.

> [!IMPORTANT]
> **Avoid Codebase Drift:** Checkpoint files describe the state of your workspace at a specific moment. If you make major manual modifications to your files before injecting the checkpoint into the target terminal, the target agent may get confused by the outdated summaries. Inject checkpoints immediately after creating them.
