# Chat as Command Cockpit

## Goal
The right-side chat gains three explicit commands alongside its existing abilities — **status** ("what's running?"), **checkpoint** ("checkpoint the claude tab"), and **pass work** ("pass the claude work to the gemini tab") — plus existing plan generation and plain chat. Every action is user-requested; nothing auto-fires, and the handover still requires the dialog confirm (consistent with the manual-only rule).

## Approach: extend the existing classifier pattern — no tool-calling protocol
The chat already (a) classifies every message via `buildIntentClassifyPrompt` (plan|chat) and (b) executes an LLM-emitted directive (`INJECT → <title>: <msg>`). I extend both:

### 1. Prompts — `src/services/orchestratorPrompts.ts`
- `buildIntentClassifyPrompt` → three-way output: `'plan' | 'command' | 'chat'` (command = the user asks the orchestrator itself to act: show status, checkpoint a terminal, hand work to another terminal). Update the `handleSend` regex to test `command` before `plan`.
- New `buildCommandExtractPrompt(message, sessionTitles)`: one LLM call returning strict JSON `{ action: 'status'|'checkpoint'|'pass_work', source?, destination? }` with tab titles from the active Space.
- New `parseCommandResponse(response): CommandRequest | null` mirroring `parsePlanGenResponse` (extract first `{...}`, JSON.parse, validate action against the allowlist). `null` → user gets a "couldn't interpret" message with example phrasings — no silent fallback.

### 2. Execution — `GroupChat.tsx` (new `command` branch in `handleSend`)
- Title→session resolution: same exact→substring matching the plan path uses; unmatched names get a system message listing the actual tabs — never silently rerouted.
- **status** → deterministic, no LLM: one system message listing each tab (title, `dynamicTitle` or "shell", agent-session flag from `autonomousOrchestrator.getActiveSessionIds()`, `isCheckpointing`, last checkpoint file if it belongs to that tab). Fast and can't hallucinate state.
- **checkpoint** → existing `captureSessionNow(id)` → system message with the checkpoint file path.
- **pass_work** → `captureSessionNow(source)` → `setPendingInjectionSnapshot(snapshot, destinationId)` → the existing handover dialog opens with the destination **preselected**; the user still clicks "Pass & Resume".
- GroupChat's `useDashboard` destructure gains `captureSessionNow` and `setPendingInjectionSnapshot` (both already in the context API).

### 3. Preselect plumbing
- `DashboardContext`: `setPendingInjectionSnapshot(s, preselectTargetId?)` — new `pendingInjectionTargetId` state, cleared on dismiss; existing call sites unchanged.
- `AppLayout` passes it to `ContinuationModal`; the modal accepts `preselectedTargetId?: string` (initial selection + small reconcile effect when the prop arrives).

### 4. Polish
- Empty-state suggestion chips: add "What's running right now?". Existing plan/INJECT paths untouched.

### 5. Tests — new `src/tests/orchestratorPrompts.test.ts`
- `parseCommandResponse`: plain JSON, code-fenced JSON, unknown action, garbage → null.
- Intent prompt: three-way classification instruction present; command regex order in a shared helper if extracted.

### 6. Docs
- `USER_GUIDE.md`: short "Orchestrator chat commands" section (the three commands; pass-work still confirms in the dialog).

## Files
`orchestratorPrompts.ts`, `GroupChat.tsx`, `DashboardContext.tsx`, `AppLayout.tsx`, `ContinuationModal.tsx`, new test file, `USER_GUIDE.md`.

## Out of scope
Real function-calling/tool protocol, auto-executed injections, tools beyond the three above.

## Verification
- `npm test` + `npm run build` + prettier clean.
- Manual: "what's running?" → instant status message; "checkpoint the claude tab" → checkpoint + path; "pass claude work to gemini tab" → dialog opens preselected on gemini; existing plan and chat intents still behave as before.