# Terminal Groups Redesign

**Date:** 2026-06-05  
**Status:** Approved

## Problem

Terminal state is fragmented across three places:

1. `TerminalSession` lives in `DashboardContext` (tab metadata)
2. Split tree lives in `useSplitTree` (layout only, references sessions by ID)
3. Persistence splits them into `tabs: PersistedTab[]` + `groups: any[]` (reconciled on restore)

Result: cross-referencing everywhere, a `useEffect` to keep sessions/groups in sync, 7 tree-traversal utilities exposed as public API, and `groups` typed as `any[]` in storage.

## Goal

Workspace owns an array of `TerminalGroup`s. Each group owns its `Tab[]`. Split layout is an internal detail of the group, hidden behind a clean hook API.

## Data Model

```typescript
// src/types/terminal.types.ts

interface Tab {
  id: string
  title: string
  shell: string
  shellArgs: string[]
  color: string | null
  order: number
  interruptPolicy: InterruptPolicy
}

interface TerminalGroup {
  id: string
  tabs: Tab[]          // group owns its tabs (flat array)
  activeTabId: string  // active tab in tab bar
  activePaneId: string // focused pane in split view
  layout: SplitNode    // visual arrangement — internal detail
}

interface TerminalGroupsState {
  groups: TerminalGroup[]
  activeGroupId: string
}
```

`SplitNode` (`SplitLeaf | SplitContainer`) is unchanged — it becomes an internal implementation detail rather than a public data structure.

## Hook API

```typescript
// src/hooks/useTerminalGroups.ts

function useTerminalGroups(): {
  // State
  groups: TerminalGroup[]
  activeGroupId: string
  activeGroup: TerminalGroup | undefined
  visibleTabIds: string[]   // tabs in active group's split panes
  allTabs: Tab[]            // flat across all groups (for Conductor/Chat)

  // Tab operations
  addTab(groupId: string, tab: Omit<Tab, 'id'>): string
  removeTab(tabId: string): void
  updateTab(tabId: string, patch: Partial<Tab>): void
  reorderTabs(groupId: string, fromIdx: number, toIdx: number): void
  setActiveTab(tabId: string): void
  moveTabToGroup(tabId: string, targetGroupId: string): void

  // Group operations
  addGroup(firstTab: Omit<Tab, 'id'>): string
  removeGroup(groupId: string): void
  setActiveGroup(groupId: string): void

  // Split/layout operations
  splitTab(tabId: string, targetLeafId: string, direction: 'h' | 'v', before: boolean): void
  closePane(leafId: string): void
  setActivePaneId(leafId: string): void
  setRatios(containerId: string, ratios: number[]): void

  // Restore
  restore(state: TerminalGroupsState): void
}
```

## Persistence

```typescript
// Old
interface PersistedTerminalState {
  tabs: PersistedTab[]   // separate from layout
  groups: any[]          // typed as any
  activeGroupId: string
}

// New
type PersistedTerminalState = TerminalGroupsState
// serialize/deserialize directly — no reconciliation step
```

## DashboardContext Compatibility

`terminalSessions` stays in context as a **derived computed value** — not state. Conductor and Chat panels need zero changes.

```typescript
const terminalSessions: TerminalSession[] = useMemo(
  () => allTabs.map(tab => ({ ...tab, workspaceId })),
  [allTabs, workspaceId]
)
```

## File Changes

| Action | File |
|--------|------|
| New | `src/hooks/useTerminalGroups.ts` |
| New | `src/utils/splitTree.ts` (pure tree functions, no hook) |
| Delete | `src/hooks/useSplitTree.ts` |
| Update | `src/types/terminal.types.ts` — add `Tab`, `TerminalGroup`, `TerminalGroupsState` |
| Update | `src/services/storage.ts` — `PersistedTerminalState` = `TerminalGroupsState` |
| Update | `src/context/DashboardContext.tsx` — derive `terminalSessions` from hook |
| Update | `src/components/terminal/TerminalContainer.tsx` — swap hook |

## Key Invariants

- A group always has at least one tab.
- `activeTabId` always references a tab that exists in `group.tabs`.
- `activePaneId` always references a leaf node in `group.layout`.
- `layout` leaf `tabId`s are always a subset of `group.tabs[].id`.
- Removing a tab removes it from layout too (all panes showing that tab collapse).
- Removing the last tab in a group removes the group.
