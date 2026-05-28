import { useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type SplitLeaf = {
  type: 'leaf';
  id: string;
  sessionId: string;
};

export type SplitContainer = {
  type: 'split';
  id: string;
  direction: 'h' | 'v';
  children: SplitNode[];
  ratios: number[]; // sum = 1
};

export type SplitNode = SplitLeaf | SplitContainer;

// ── Tree helpers ───────────────────────────────────────────────────────────────

function newLeaf(sessionId: string): SplitLeaf {
  return { type: 'leaf', id: crypto.randomUUID(), sessionId };
}

function findFirstLeaf(node: SplitNode): SplitLeaf | null {
  if (node.type === 'leaf') return node;
  for (const child of node.children) {
    const found = findFirstLeaf(child);
    if (found) return found;
  }
  return null;
}

export function findNodeById(node: SplitNode, id: string): SplitNode | null {
  if (node.id === id) return node;
  if (node.type !== 'split') return null;
  for (const child of node.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

export function collectLeafSessionIds(node: SplitNode): string[] {
  if (node.type === 'leaf') return [node.sessionId];
  return node.children.flatMap(collectLeafSessionIds);
}

function collectLeafIdsWithSession(node: SplitNode, sessionId: string, out: string[]): void {
  if (node.type === 'leaf') {
    if (node.sessionId === sessionId) out.push(node.id);
    return;
  }
  for (const child of node.children) collectLeafIdsWithSession(child, sessionId, out);
}

// Traverse the tree, replacing or deleting the node with targetId.
// Return null from fn to delete. Returns null if the root itself is deleted.
function mapNode(
  node: SplitNode,
  targetId: string,
  fn: (n: SplitNode) => SplitNode | null,
): SplitNode | null {
  if (node.id === targetId) return fn(node);
  if (node.type !== 'split') return node;

  let anyChanged = false;
  const kept: { node: SplitNode; origIdx: number }[] = [];

  for (let i = 0; i < node.children.length; i++) {
    const result = mapNode(node.children[i], targetId, fn);
    if (result !== node.children[i]) anyChanged = true;
    if (result !== null) kept.push({ node: result, origIdx: i });
  }

  if (!anyChanged) return node;
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0].node; // collapse single child

  const keptRatios = kept.map(k => node.ratios[k.origIdx]);
  const sum = keptRatios.reduce((a, b) => a + b, 0);

  return {
    ...node,
    children: kept.map(k => k.node),
    ratios: keptRatios.map(r => r / sum),
  };
}

// ── Hook ───────────────────────────────────────────────────────────────────────

interface SplitState {
  tree: SplitNode;
  activePaneId: string;
}

export function useSplitTree(initialSessionId: string) {
  const [state, setState] = useState<SplitState>(() => {
    const root = newLeaf(initialSessionId);
    return { tree: root, activePaneId: root.id };
  });

  const setActivePaneId = useCallback((id: string) => {
    setState(prev => ({ ...prev, activePaneId: id }));
  }, []);

  const splitPane = useCallback((leafId: string, direction: 'h' | 'v', newSessionId: string, before = false) => {
    setState(prev => {
      const newLeafNode = newLeaf(newSessionId);
      const newTree = mapNode(prev.tree, leafId, node => {
        if (node.type !== 'leaf') return node;
        const children = before ? [newLeafNode, node] : [node, newLeafNode];
        return {
          type: 'split' as const,
          id: crypto.randomUUID(),
          direction,
          children,
          ratios: [0.5, 0.5],
        };
      });
      return { tree: newTree ?? prev.tree, activePaneId: newLeafNode.id };
    });
  }, []);

  // Atomically remove sessionId from its current pane and split targetLeafId to show it.
  // If sessionId is already in targetLeafId, no-op.
  const moveSession = useCallback((sessionId: string, targetLeafId: string, direction: 'h' | 'v', before: boolean) => {
    setState(prev => {
      const toRemove: string[] = [];
      collectLeafIdsWithSession(prev.tree, sessionId, toRemove);

      let tree = prev.tree;
      let activePaneId = prev.activePaneId;

      // Remove source panes (skip the target pane itself)
      for (const leafId of toRemove) {
        if (leafId === targetLeafId) continue;
        if (tree.type === 'leaf') break;
        const newTree = mapNode(tree, leafId, () => null);
        if (newTree !== null) tree = newTree;
      }

      if (toRemove.includes(activePaneId) && activePaneId !== targetLeafId) {
        activePaneId = findFirstLeaf(tree)?.id ?? activePaneId;
      }

      // Split the target pane (no-op if it already shows this session)
      const newLeafNode = newLeaf(sessionId);
      const newTree = mapNode(tree, targetLeafId, node => {
        if (node.type !== 'leaf') return node;
        if (node.sessionId === sessionId) return node; // already there, no-op
        const children = before ? [newLeafNode, node] : [node, newLeafNode];
        return {
          type: 'split' as const,
          id: crypto.randomUUID(),
          direction,
          children,
          ratios: [0.5, 0.5],
        };
      });

      return { tree: newTree ?? tree, activePaneId: newLeafNode.id };
    });
  }, []);

  const closePane = useCallback((leafId: string) => {
    setState(prev => {
      if (prev.tree.type === 'leaf') return prev;
      const newTree = mapNode(prev.tree, leafId, () => null);
      if (!newTree) return prev;
      const activePaneId = prev.activePaneId === leafId
        ? (findFirstLeaf(newTree)?.id ?? prev.activePaneId)
        : prev.activePaneId;
      return { tree: newTree, activePaneId };
    });
  }, []);

  const setRatios = useCallback((containerId: string, ratios: number[]) => {
    setState(prev => {
      const newTree = mapNode(prev.tree, containerId, node => {
        if (node.type !== 'split') return node;
        return { ...node, ratios };
      });
      return { ...prev, tree: newTree ?? prev.tree };
    });
  }, []);

  const setLeafSession = useCallback((leafId: string, sessionId: string) => {
    setState(prev => {
      const newTree = mapNode(prev.tree, leafId, node => {
        if (node.type !== 'leaf') return node;
        return { ...node, sessionId };
      });
      return { ...prev, tree: newTree ?? prev.tree };
    });
  }, []);

  // Remove all panes showing sessionId (called before killing a session).
  const removePanesBySession = useCallback((sessionId: string) => {
    setState(prev => {
      const toRemove: string[] = [];
      collectLeafIdsWithSession(prev.tree, sessionId, toRemove);
      if (toRemove.length === 0) return prev;

      let tree = prev.tree;
      let activePaneId = prev.activePaneId;

      for (const leafId of toRemove) {
        if (tree.type === 'leaf') break; // never remove last pane
        const newTree = mapNode(tree, leafId, () => null);
        if (newTree !== null) tree = newTree;
      }

      if (toRemove.includes(activePaneId)) {
        activePaneId = findFirstLeaf(tree)?.id ?? activePaneId;
      }

      return { tree, activePaneId };
    });
  }, []);

  const resetTree = useCallback((sessionId: string) => {
    const root = newLeaf(sessionId);
    setState({ tree: root, activePaneId: root.id });
  }, []);

  return {
    tree: state.tree,
    activePaneId: state.activePaneId,
    setActivePaneId,
    splitPane,
    moveSession,
    closePane,
    setRatios,
    setLeafSession,
    removePanesBySession,
    resetTree,
    visibleSessionIds: collectLeafSessionIds(state.tree),
  };
}
