import { useState, useCallback, useEffect } from 'react';

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

export interface Group {
  id: string;
  tree: SplitNode;
  activePaneId: string;
}

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

export function findLeafForSession(node: SplitNode, sessionId: string): SplitLeaf | null {
  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? node : null;
  }
  for (const child of node.children) {
    const found = findLeafForSession(child, sessionId);
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

export function removeSessionFromTree(node: SplitNode, sessionId: string): SplitNode | null {
  const toRemove: string[] = [];
  collectLeafIdsWithSession(node, sessionId, toRemove);
  if (toRemove.length === 0) return node;

  let tree: SplitNode | null = node;
  for (const leafId of toRemove) {
    if (tree === null) break;
    tree = mapNode(tree, leafId, () => null);
  }
  return tree;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useSplitTree(sessions: { id: string }[]) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string>('');

  // Synchronize groups with the sessions list:
  // 1. Remove any closed sessions
  // 2. Add new sessions to their own group
  useEffect(() => {
    const sessionIds = new Set(sessions.map(s => s.id));
    setGroups(prevGroups => {
      let nextGroups = [...prevGroups];

      // Remove any leaf nodes whose session is no longer in sessions list
      nextGroups = nextGroups.map(g => {
        let tree = g.tree;
        const leafSessions = collectLeafSessionIds(tree);
        for (const sid of leafSessions) {
          if (!sessionIds.has(sid)) {
            const newTree = removeSessionFromTree(tree, sid);
            if (newTree) tree = newTree;
          }
        }
        return { ...g, tree };
      });

      // Filter out empty groups
      nextGroups = nextGroups.filter(g => collectLeafSessionIds(g.tree).length > 0);

      // For any session in sessions that is not in any group, create a new group
      const existingSessionIds = new Set(nextGroups.flatMap(g => collectLeafSessionIds(g.tree)));
      for (const s of sessions) {
        if (!existingSessionIds.has(s.id)) {
          const root = newLeaf(s.id);
          nextGroups.push({
            id: crypto.randomUUID(),
            tree: root,
            activePaneId: root.id,
          });
        }
      }

      return nextGroups;
    });
  }, [sessions]);

  // Ensure activeGroupId is always valid (fallback to first group or empty)
  useEffect(() => {
    if (groups.length > 0) {
      const activeGroupExists = groups.some(g => g.id === activeGroupId);
      if (!activeGroupExists) {
        setActiveGroupId(groups[0].id);
      }
    } else {
      setActiveGroupId('');
    }
  }, [groups, activeGroupId]);

  const activeGroup = groups.find(g => g.id === activeGroupId) || groups[0];
  const tree = activeGroup ? activeGroup.tree : { type: 'leaf' as const, id: '', sessionId: '' };
  const activePaneId = activeGroup ? activeGroup.activePaneId : '';

  const setActivePaneId = useCallback((id: string) => {
    setGroups(prev => prev.map(g => g.id === activeGroupId ? { ...g, activePaneId: id } : g));
  }, [activeGroupId]);

  const switchSession = useCallback((sessionId: string) => {
    setGroups(prevGroups => {
      const targetGroup = prevGroups.find(g => collectLeafSessionIds(g.tree).includes(sessionId));
      if (targetGroup) {
        setActiveGroupId(targetGroup.id);
        const leaf = findLeafForSession(targetGroup.tree, sessionId);
        if (leaf) {
          return prevGroups.map(g => g.id === targetGroup.id ? { ...g, activePaneId: leaf.id } : g);
        }
      }
      return prevGroups;
    });
  }, []);

  const moveSession = useCallback((sessionId: string, targetLeafId: string, direction: 'h' | 'v', before: boolean) => {
    setGroups(prevGroups => {
      let tgtGroupIdx = -1;
      for (let i = 0; i < prevGroups.length; i++) {
        if (findNodeById(prevGroups[i].tree, targetLeafId)) {
          tgtGroupIdx = i;
          break;
        }
      }
      if (tgtGroupIdx === -1) return prevGroups;

      let srcGroupIdx = -1;
      for (let i = 0; i < prevGroups.length; i++) {
        const leafIds: string[] = [];
        collectLeafIdsWithSession(prevGroups[i].tree, sessionId, leafIds);
        if (leafIds.length > 0) {
          srcGroupIdx = i;
          break;
        }
      }

      let nextGroups = [...prevGroups];

      // 1. Remove from source tree
      if (srcGroupIdx !== -1) {
        const srcGroup = nextGroups[srcGroupIdx];
        const newTree = removeSessionFromTree(srcGroup.tree, sessionId);
        if (newTree === null) {
          nextGroups[srcGroupIdx] = { ...srcGroup, tree: null as any };
        } else {
          let activePaneId = srcGroup.activePaneId;
          const toRemove: string[] = [];
          collectLeafIdsWithSession(srcGroup.tree, sessionId, toRemove);
          if (toRemove.includes(activePaneId)) {
            activePaneId = findFirstLeaf(newTree)?.id ?? activePaneId;
          }
          nextGroups[srcGroupIdx] = {
            ...srcGroup,
            tree: newTree,
            activePaneId,
          };
        }
      }

      // 2. Split in target tree
      const targetGroup = nextGroups[tgtGroupIdx];
      const newLeafNode = newLeaf(sessionId);
      const newTree = mapNode(targetGroup.tree, targetLeafId, node => {
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

      nextGroups[tgtGroupIdx] = {
        ...targetGroup,
        tree: newTree ?? targetGroup.tree,
        activePaneId: newLeafNode.id,
      };

      return nextGroups.filter(g => g.tree !== null && collectLeafSessionIds(g.tree).length > 0);
    });
  }, []);

  const closePane = useCallback((leafId: string) => {
    setGroups(prev => {
      const activeGroup = prev.find(g => g.id === activeGroupId);
      if (!activeGroup || activeGroup.tree.type === 'leaf') return prev;
      
      const leafNode = findNodeById(activeGroup.tree, leafId);
      if (!leafNode || leafNode.type !== 'leaf') return prev;
      const sessionId = leafNode.sessionId;

      const newTree = mapNode(activeGroup.tree, leafId, () => null);
      if (!newTree) return prev;
      const activePaneId = activeGroup.activePaneId === leafId
        ? (findFirstLeaf(newTree)?.id ?? activeGroup.activePaneId)
        : activeGroup.activePaneId;
      const nextGroups = prev.map(g => g.id === activeGroupId ? { ...g, tree: newTree, activePaneId } : g);
      
      const root = newLeaf(sessionId);
      nextGroups.push({
        id: crypto.randomUUID(),
        tree: root,
        activePaneId: root.id,
      });
      return nextGroups;
    });
  }, [activeGroupId]);

  const setRatios = useCallback((containerId: string, ratios: number[]) => {
    setGroups(prev => prev.map(g => {
      if (g.id !== activeGroupId) return g;
      const newTree = mapNode(g.tree, containerId, node => {
        if (node.type !== 'split') return node;
        return { ...node, ratios };
      });
      return { ...g, tree: newTree ?? g.tree };
    }));
  }, [activeGroupId]);

  const setLeafSession = useCallback((leafId: string, sessionId: string) => {
    setGroups(prev => prev.map(g => {
      if (g.id !== activeGroupId) return g;
      const newTree = mapNode(g.tree, leafId, node => {
        if (node.type !== 'leaf') return node;
        return { ...node, sessionId };
      });
      return { ...g, tree: newTree ?? g.tree };
    }));
  }, [activeGroupId]);

  const removePanesBySession = useCallback((sessionId: string) => {
    setGroups(prev => {
      let nextGroups = prev.map(g => {
        const newTree = removeSessionFromTree(g.tree, sessionId);
        if (newTree === null) return { ...g, tree: null as any };
        let activePaneId = g.activePaneId;
        const toRemove: string[] = [];
        collectLeafIdsWithSession(g.tree, sessionId, toRemove);
        if (toRemove.includes(activePaneId)) {
          activePaneId = findFirstLeaf(newTree)?.id ?? activePaneId;
        }
        return { ...g, tree: newTree, activePaneId };
      });
      nextGroups = nextGroups.filter(g => g.tree !== null && collectLeafSessionIds(g.tree).length > 0);
      
      const root = newLeaf(sessionId);
      nextGroups.push({
        id: crypto.randomUUID(),
        tree: root,
        activePaneId: root.id,
      });
      return nextGroups;
    });
  }, []);

  const resetTree = useCallback((sessionId: string) => {
    const root = newLeaf(sessionId);
    const g: Group = {
      id: crypto.randomUUID(),
      tree: root,
      activePaneId: root.id,
    };
    setGroups([g]);
    setActiveGroupId(g.id);
  }, []);

  const initializeGroups = useCallback((newGroups: Group[], newActiveGroupId: string) => {
    setGroups(newGroups);
    setActiveGroupId(newActiveGroupId);
  }, []);

  return {
    tree,
    activePaneId,
    setActivePaneId,
    moveSession,
    closePane,
    setRatios,
    setLeafSession,
    removePanesBySession,
    resetTree,
    initializeGroups,
    visibleSessionIds: collectLeafSessionIds(tree),
    groups,
    activeGroupId,
    switchSession,
  };
}
