# AgentDeck Full Overhaul — Design Spec
**Date:** 2026-05-25  
**Approach:** Component-by-component (Approach B)  
**Scope:** Architecture gap closure + bug fixes + UX elevation across all 5 surface areas

---

## 0. Guiding Principles

- Every bug fix is minimal and surgical — no behaviour changes beyond the fix.
- Every missing feature matches the architecture doc intent exactly.
- UX changes follow the existing dark-terminal aesthetic (`#070d14` bg, `#ff9d00` brand amber) and use Emotion CSS-in-JS (no new style systems).
- No new runtime dependencies unless strictly necessary.
- All new localStorage keys are namespaced `agentdeck:*`.

---

## 1. GroupChat (`src/components/ui/GroupChat.tsx` + `src/services/ollamaRelay.ts` + `src/services/bufferWatcher.ts`)

### 1.1 Bug: Stale closure in `onDone`
**Problem:** `onDone` calls `setMessages` twice — the second call uses a functional updater as a state-reader to extract the finished assistant content before appending to `apiHistory`. If React batches the first update, the second call sees stale state.

**Fix:** Track the streaming content in a `streamingContentRef` (`useRef<string>('')`) that is updated alongside every `onToken` call. In `onDone`, use the ref value directly to append to `apiHistory` — no second `setMessages` read needed. One `setMessages` call marks the message as non-streaming; one `setApiHistory` appends using the ref value.

### 1.2 Bug: Chat history lost on remount
**Problem:** `messages` and `apiHistory` are local state — unmounting the component (switching right-panel tabs, navigating away) wipes the conversation.

**Fix:** On mount, load persisted messages from `localStorage` key `agentdeck:chat:{workspaceId}:{spaceId ?? 'workspace'}`. On every message append, save to the same key (debounced 300ms). Cap stored messages at 100. On `spaceId` change, swap to the matching key. Add a "Clear" icon button in the header that wipes the key and resets state.

### 1.3 Missing: `bufferWatcher.watchForSummary`
**Problem:** `bufferWatcher.ts` has no summary mode. The architecture requires Ollama to summarise live terminal output and post it as `agent-summary` messages in the Chat feed.

**Fix:** Add a 4th mode `'summary'` to `BufferWatchMode`. In summary mode, `onData` fires a debounced `onChunk` callback (800ms debounce, min 60 chars of new content) rather than scanning for markers. `watchForSummary(sessionId, onChunk)` puts the session in summary mode without clearing the buffer. `clearSummary(sessionId)` returns it to idle.

GroupChat subscribes to `watchForSummary` for every session in the active space when the "Live Feed" toggle is on. Each chunk is sent to `summariseChunk()` (new function in `ollamaRelay.ts`) — a non-streaming single-turn Ollama call. The result is appended as an `agent-summary` `ChatMessage` in the feed with the tab's color dot.

### 1.4 Missing: Terminal injection from chat
**Problem:** When a user asks Ollama to "tell [terminal] to do X", nothing happens — there is no `write_pty` call from GroupChat.

**Fix:** After each complete Ollama response, run a lightweight parser that looks for the pattern `INJECT → <session-title>: <message>` in the response. If found, call `invoke('write_pty', { sessionId, data: message + '\n' })` and append a styled "✦ Sent to [Tab Name]: …" system message (amber left border, lock icon) to the feed. The system prompt is updated to instruct Ollama to use this pattern when the user asks it to relay a message.

### 1.5 Missing: "Save to Prompt Vault" on messages
**Fix:** On hover over any assistant message bubble, show a small bookmark icon (`BookmarkPlus`). Clicking it calls `addSavedPrompt` with `title` auto-generated as first 60 chars of content, `content` as full message, `workspaceId` and `spaceId` set. Shows toast "Saved to Prompt Vault".

### 1.6 Missing: Export transcript
**Fix:** Download icon in header. Exports `agentdeck-chat-{date}.md` with each message as `**You:** …` / `**Ollama:** …` blocks.

### 1.7 UX improvements
- **Empty state:** 3 clickable suggested prompts — "What is everyone working on right now?", "Summarise what [first session title] has done so far", "Tell [first session title] to write a status update". Clicking pre-fills the textarea.
- **Message rendering:** Replace `<pre>` with a simple inline renderer: code fences (``` ``` ```) → `<code>` blocks with monospace styling; `**bold**` → `<strong>`; backtick inline code → `<code>`. No external library needed.
- **Inject confirmation chip:** The "Sent to X" system message shows a colored dot matching the target tab's color.
- **Live Feed toggle:** A small `Activity` icon button in the header toggles `watchForSummary` subscriptions. Tooltip: "Live terminal summaries". Persisted per session in `localStorage`.
- **Header session list tooltip:** Hovering the "N sessions" badge shows the session titles.

---

## 2. Conductor / PlanBuilder (`src/components/conductor/WorkspaceConductor.tsx` + `src/components/conductor/PlanBuilder.tsx` + `src/types/conductor.types.ts`)

### 2.1 Bug: `spaceId: ''` vs `null`
**Problem:** `handleNewPlan` assigns `spaceId: activeSpaceId ?? ''`. Plans without a space get `spaceId: ''`. The filter `p.spaceId === activeSpaceId` compares `''` against `null` — these plans silently disappear when any space is activated.

**Fix:** Change `OrchestratorPlan.spaceId` type from `string` to `string | null`. Change `handleNewPlan` to `spaceId: activeSpaceId`. Update the filter to handle null correctly: `if (activeSpaceId) return p.spaceId === activeSpaceId; return !p.spaceId || p.spaceId === '';` — this shows both null and empty-string plans when no space is active (backward compat for existing data). Also run a storage migration to convert `spaceId: ''` → `spaceId: null`.

### 2.2 Bug: PlanBuilder receives all workspace sessions instead of space sessions
**Problem:** `WorkspaceConductor` always passes `workspaceSessions` (all sessions for the workspace) to `PlanBuilder`. Architecture says: when a space is active, the session picker should show only sessions in that space.

**Fix:** In `WorkspaceConductor`, compute `planSessions`:
```
const planSessions = activeSpace
  ? workspaceSessions.filter(s => activeSpace.sessionIds.includes(s.id))
  : workspaceSessions;
```
Pass `planSessions` to `PlanBuilder` instead of `workspaceSessions`.

### 2.3 Bug: `HistoryCard` wrong TypeScript type
**Problem:** `sessions: ReturnType<typeof Array.prototype.filter>` evaluates to `any[]`.

**Fix:** Change type to `sessions: TerminalSession[]`. Import `TerminalSession` from types.

### 2.4 UX improvements
- **Space scope banner:** Already present; add a tooltip: "Plans in this view are scoped to this Space. Sessions available in the plan builder are also filtered to this Space."
- **Session count hint in PlanBuilder:** Below the session dropdown, show "N session(s) available in this space" when a space is active, to make clear why they might see fewer options.
- **Run controls visibility:** Move Pause/Resume/Stop out of the tab bar (currently hidden until a plan is running) into a persistent "Run Controls" area at the bottom of the Pipeline tab, always visible when `liveTasks.length > 0`.
- **Plan goal placeholder:** Change from empty to "Describe the overall goal, e.g. 'Build and test the auth system'".

---

## 3. Sidebar / Spaces (`src/components/layout/Sidebar.tsx` + `src/components/ui/SpaceManagerModal.tsx`)

### 3.1 Bug: Stale `sessionIds` with no user signal
**Problem:** When the app restarts, terminal sessions get new IDs. Spaces still hold old IDs. GroupChat's `groupSessions` becomes empty with no explanation.

**Fix:** In `GroupChat` and `WorkspaceConductor`, when `activeSpace.sessionIds` has entries but `groupSessions.length === 0`, show a yellow banner: "⚠ Sessions in this Space may have changed since last launch. Re-add them via the Space settings." The "settings" text is a clickable link that opens `SpaceManagerModal` for that space directly.

In `SpaceManagerModal`, highlight stale IDs: cross-reference `selectedIds` against live `terminalSessions`. If a stored ID is no longer active, show it greyed out with a "(session ended)" label and a remove button.

### 3.2 UX improvements
- **Sidebar "new workspace" shortcut:** Add a small `+` icon at the end of the "Workspaces" section label. Clicking it opens the New Workspace dialog directly (currently requires navigating to the Overview grid).
- **Space count badge:** Next to each workspace name, show a muted pill with the count of its spaces (e.g. "2 spaces").
- **Conductor running indicator:** When a plan is running in a space, show a small pulsing amber dot next to the space name in the sidebar.
- **Collapse/expand workspace list:** The workspace list is already collapsible per-workspace. Make the behavior consistent: single-click expands spaces, double-click (or terminal icon) opens in console.

---

## 4. Terminal Tabs (`src/components/terminal/TerminalContainer.tsx`)

### 4.1 UX improvements
- **"New Tab" button:** Replace the `<span>New Tab</span>` label with just the `+` icon to save horizontal space. The shell picker button already communicates what shell will be used.
- **Tab overflow indicator:** When tabs overflow horizontally (tabsList scrolls), show a subtle `…` indicator or fade at the right edge so users know tabs are hidden.
- **Stale space session warning:** When a terminal tab is a member of a space that has stale IDs (the tab's ID is not in any space's `sessionIds`), show a small dot indicator on the tab. Tooltip: "This session is not assigned to any Space."
- **Context menu on right-click:** Show "Rename", "Change color", "Close" as a context menu. Currently these actions are tiny icons that only appear on hover.

---

## 5. Overview / ConsoleView (`src/pages/Overview.tsx`)

### 5.1 UX improvements
- **Console header — "rename workspace":** Double-clicking the workspace name in the console header enables inline editing (same pattern as terminal tab rename).
- **Console split resizeable:** Replace the fixed 62%/38% split with a CSS `resize` handle or `onMouseMove` drag approach. Persist the split ratio in `localStorage` keyed `agentdeck:splitRatio`.
- **Right panel tab — running indicator:** When a plan is running in the active space, show a small pulsing dot on the "Conductor" tab label.
- **Grid card — space count:** On each workspace card in the grid view, show a "N spaces" badge so users know at a glance which workspaces have agent groups set up.
- **Grid card — keyboard shortcut:** Add `title` attribute to "Open Console" button showing "Enter" as the shortcut. Wire `onKeyDown` on the card to open on Enter.
- **Empty state illustration:** Add an SVG illustration (simple, inline) to the empty workspaces state to make the first-run experience less stark.

---

## 6. Shared / Cross-cutting

### 6.1 `ollamaRelay.ts` — new `summariseChunk` function
```typescript
export async function summariseChunk(
  chunk: string,
  tabTitle: string,
  ollamaHost: string,
  model: string,
): Promise<string>
```
Single-turn, non-streaming call. System prompt: "Summarise the following terminal output from agent '{tabTitle}' in 1–2 sentences. Be direct and factual. Output only the summary, nothing else." Throws on Ollama error (caller handles gracefully).

### 6.2 TypeScript strictness
- Fix `HistoryCard` `sessions: any[]` → `TerminalSession[]`
- Fix `OrchestratorPlan.spaceId: string` → `string | null`
- Remove any remaining `@ts-ignore` or `eslint-disable` comments added as workarounds

### 6.3 Storage migration additions
In `migrate()` in `storage.ts`:
- Convert `spaceId: ''` → `spaceId: null` on all plans, task logs, saved prompts
- Detect and remove `sessionIds` entries that reference non-existent session IDs (can't be done at storage layer since sessions are ephemeral — skip this, handled in UI layer per §3.1)

---

## Implementation Order (Component-by-Component)

1. **Types + storage migration** (no UI) — `conductor.types.ts`, `storage.ts`, `workspace.types.ts`
2. **BufferWatcher** — add `'summary'` mode + `watchForSummary` + `clearSummary`
3. **OllamaRelay** — add `summariseChunk` function
4. **GroupChat** — all 7 items above
5. **WorkspaceConductor + PlanBuilder** — all 4 items above
6. **Sidebar + SpaceManagerModal** — all 2 items above
7. **TerminalContainer** — UX items
8. **Overview** — UX items

---

## Out of Scope (deferred)
- Keyboard shortcut to jump terminal → group chat (requires global hotkey system)
- Resizable split panel (requires additional drag logic — deferred to polish pass)
- SVG empty state illustration (design asset needed)
- Full Markdown renderer (regex-based inline renderer ships; full CommonMark deferred)
