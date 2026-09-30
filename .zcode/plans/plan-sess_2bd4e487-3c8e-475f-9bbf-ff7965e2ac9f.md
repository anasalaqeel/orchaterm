# Manual, User-Driven Agent Handover

## Goal
When an agent hits its usage limit, nothing happens automatically. The user opens a new tab, starts whichever agent they want, and then uses one explicit action — **"Pass work to another terminal…"** — to hand the checkpointed work over to that terminal.

## Part 1 — Remove the automatic handover behaviors

1. **Remove auto-injection (`'auto'` resume mode):** today, if a target session is configured, a checkpoint is silently injected into it (`DashboardContext.tsx:457-464`). Remove:
   - `mode` and `targetSessionId` from `ContinuationConfig` (`src/types/continuation.types.ts`) and all branching on them (`DashboardContext.tsx` defaults ~202/233/295/797, `sessionContinuationService.ts:106-111` fallback config).
   - The "Resume mode" selector and its `'auto'`/`'semi'`/`'file-only'` options in `src/pages/Settings.tsx:1050-1080`.
   - `targetSessionId` prop threading in `AppLayout.tsx:136` and `ContinuationModal.tsx:22,67,72`.
   - Legacy persisted settings carrying these fields are simply ignored.
2. **Remove the auto-popping modal:** when limit/stop detection writes a checkpoint, only a toast is shown ("Checkpoint saved — pass the work when ready"). Remove the `pendingInjectionSnapshot` auto-open path (`DashboardContext.tsx:466`, `AppLayout.tsx:131-136`). The dialog now opens **only** from an explicit user action.
3. **Keep (notification/file-only, never moves work):** limit detection + auto checkpoint file write, periodic snapshots, and the existing per-feature on/off toggle in Settings. Settings page keeps: enable toggle, snapshot interval, max context chars.

Untouched: orchestrator engine relay, needsBroker, autonomous orchestrator, pending-plan reassignment (separate subsystems, not handover).

## Part 2 — The manual "Pass work" flow (the actual feature)

**New tab context-menu item: "Pass work to another terminal…"** (`src/components/terminal/TerminalContainer.tsx`, alongside the existing "Create Checkpoint Now" / "Inject Last Checkpoint" items ~lines 1280/1315):

1. Captures a fresh checkpoint of the source session right now (reuses `sessionContinuationService.captureNow`).
2. Opens the handover dialog (repurposed `src/components/ui/ContinuationModal.tsx` — no longer auto-opened):
   - Lists all terminals across workspaces, including lazy-restored persisted tabs (existing logic, unchanged).
   - User picks the tab where they started the new agent, hits "Pass & Resume".
3. **New: wait-until-ready before injecting.** Before writing the resume prompt, poll the target session's buffer (`bufferWatcher.getBuffer(id).length`) every ~500 ms and inject once it's been quiet ~2.5 s (max ~15 s). This prevents the resume text from being swallowed while the newly started agent TUI is still booting — the main failure mode of the current manual flow.
4. Injects the existing resume prompt (checkpoint file path + "read the checkpoint file and continue") via `writePtyChunked`. Works with any agent since the handoff is a plain file on disk.

User's workflow end-to-end: Claude hits limit → user opens new tab, types `gemini` (or anything) → right-clicks the Claude tab → "Pass work to another terminal…" → picks the gemini tab → app waits for gemini to be ready → injects resume prompt.

## Part 3 — Docs
Update `docs/SESSION_CONTINUATION.md` and `docs/USER_GUIDE.md` (rate-limit section) to describe the manual-only flow.

## Files
Modified: `continuation.types.ts`, `DashboardContext.tsx`, `AppLayout.tsx`, `Settings.tsx`, `TerminalContainer.tsx`, `ContinuationModal.tsx`, `sessionContinuationService.ts` (fallback-config shape only), docs.
No new services, no agent registry, no rules, no engines.

## Verification
- `npm run build` (tsc) clean.
- Manual: enable continuation detection → trigger/observe a limit → confirm only a toast appears (no modal, no injection) → run "Pass work to another terminal…" into a tab with a freshly started agent → resume prompt lands after the TUI settles → new agent picks up the checkpoint. Also verify "Create Checkpoint Now" and "Inject Last Checkpoint" still work.