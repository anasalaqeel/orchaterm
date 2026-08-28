# Orchaterm User Guide

A step-by-step guide to using **Orchaterm** as your daily-driver terminal and multi-process orchestration workspace.

---

## 1. Quick Tour

```
┌────────────────────────────┬────────────────────────────┐
│                            │  [Chat]     [Pipelines]    │ ← right panel tabs
│    Terminal Tabs           ├────────────────────────────┤
│    ┌────┬────┬────┐        │  Chat tab:                 │
│    │ T1 │ T2 │ +  │        │   • Ambient LLM summary    │
│    └────┴────┴────┘        │   • Cross-session relay    │
│                            │   • Live status cards      │
│    (active terminal)       ├────────────────────────────┤
│                            │  Pipelines tab:            │
│                            │   • Plan selector          │
│                            │   • Build / Live / History │
└────────────────────────────┴────────────────────────────┘
```

- **Left Area**: Native terminal grid with split panes, GPU acceleration, search (Ctrl+F), and floating Quick Actions.
- **Right Area**: Workspace context panel with **Ambient Chat** and **Visual Pipelines**.

---

## 2. Setting Up Your LLM Provider

1. Open **Settings** (⚙️) in the sidebar.
2. Select your preferred provider:
   - **Ollama** (Default): Fast, zero-cost, offline models (e.g. `llama3.2`, `qwen2.5-coder:7b`).
   - **LM Studio**: Standard local OpenAI-compatible endpoint.
   - **Anthropic Claude / Google Gemini**: Bring your API key (ensure continuous orchestration is configured appropriately to manage token consumption).
3. Test your connection and save.

---

## 3. Workspaces & Terminal Spaces

- **Workspaces**: Map to a project directory on your filesystem.
- **Terminal Spaces**: Group related terminal sessions together (e.g. "Frontend Team", "Backend Services"). Chat feeds and pipeline plans are scoped per Space.

---

## 4. Visual Task Pipelines

Pipelines allow you to coordinate multi-session workflows across different terminal tabs:

1. Open the **Pipelines** tab in the right panel and click **+** to create a new plan.
2. **Add Tasks**: Assign each task to a specific terminal session and set dependencies (`dependsOn`).
3. **Approve & Run**: The engine dispatches Wave 1 tasks to their assigned sessions.
4. **Automated Relay**: When a process outputs the completion sentinel (`###ORCHATERM_DONE###`), Orchaterm captures the output, generates a handoff brief using your local LLM, and dispatches the next dependent tasks automatically.
5. **Manual Override**: Pause, resume, retry, or force-complete tasks at any point during live execution.

---

## 5. Prompt Vault & Quick Actions

- **Prompt Vault**: Store reusable prompts, command snippets, and templates.
- **Pin to Actions**: Pin vault items directly to your terminal toolbar as one-click injection buttons.
- **Context Variables**: Dynamically expand context at paste time (`{{selection}}`, `{{terminal_output}}`).

---

## 6. Continuous Checkpointing & Session Continuation

- When working with long-running CLI sessions, Orchaterm automatically captures rolling checkpoints.
- If a session approaches rate limits or context windows, click **Create Checkpoint Now** on the tab context menu to generate a migration checkpoint and resume cleanly in a new session.
