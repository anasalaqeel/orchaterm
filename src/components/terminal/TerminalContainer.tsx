import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { TerminalTab, TerminalTabHandle } from "./TerminalTab";
import { useDashboard } from "../../context/DashboardContext";
import { invoke } from "@tauri-apps/api/core";
import { Plus, X, Terminal, Edit2, Check, Palette, ChevronDown, Minimize2 } from "lucide-react";
import { css, cx } from "@emotion/css";
import type { TerminalSession, InterruptPolicy } from "../../types";
import { loadTerminalTabs, saveTerminalTabs } from "../../services/storage";
import { Input } from '../ui';
import { useSplitTree, findNodeById } from "../../hooks/useSplitTree";
import { computeSplitLayout, type DividerRect } from "../../utils/splitLayout";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ShellInfo {
  name: string;
  path: string;
  args: string[];
}

interface TerminalContainerProps {
  workspaceId: string;
  workspacePath: string;
  scopeKey: string;
}

type DropEdge = "left" | "right" | "top" | "bottom";

interface HoveredDrop {
  leafId: string;
  edge: DropEdge;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TAB_COLOR_PRESETS = [
  "#7B68EE",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#06b6d4",
  "#84cc16",
];

const DROP_EDGE_FRACTION = 0.28; // fraction of pane width/height that counts as an edge zone

// ── Helpers ────────────────────────────────────────────────────────────────────

function shellBasename(path: string): string {
  const part = path.replace(/\\/g, "/").split("/").pop() ?? path;
  return part.replace(/\.(exe|cmd|bat|sh)$/i, "");
}

function findPreferredShell(shells: ShellInfo[], shellPath: string): ShellInfo | null {
  const saved = (shellPath ?? "").trim();
  if (!saved || shells.length === 0) return null;
  const savedBase = shellBasename(saved).toLowerCase();
  let best: ShellInfo | null = null;
  let bestScore = 0;
  for (const s of shells) {
    let score = 0;
    if (s.path === saved) score = 3;
    else if (savedBase && shellBasename(s.path).toLowerCase() === savedBase) score = 2;
    else if (savedBase && s.name.toLowerCase().includes(savedBase)) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = s;
      if (score === 3) break;
    }
  }
  return best;
}

// ── Component ──────────────────────────────────────────────────────────────────

export const TerminalContainer: React.FC<TerminalContainerProps> = ({
  workspaceId,
  workspacePath,
  scopeKey,
}) => {
  const { settings, addTerminalSession, removeTerminalSession, updateTerminalSession } =
    useDashboard();

  // ── Shell detection ──────────────────────────────────────────────────────
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);
  const [selectedShell, setSelectedShell] = useState<ShellInfo | null>(null);
  const [shellPickerOpen, setShellPickerOpen] = useState(false);
  const [shellDropdownPos, setShellDropdownPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const shellPickerRef = useRef<HTMLDivElement>(null);
  const selectedShellRef = useRef<ShellInfo | null>(null);
  selectedShellRef.current = selectedShell;

  useEffect(() => {
    invoke<ShellInfo[]>("get_available_shells")
      .then((shells) => {
        if (shells.length === 0) return;
        setAvailableShells(shells);
        setSelectedShell(findPreferredShell(shells, settings.shellPath) ?? shells[0]);
      })
      .catch(() => {
        const fallback: ShellInfo = {
          name: shellBasename(settings.shellPath) || "Shell",
          path: settings.shellPath || "",
          args: [],
        };
        setAvailableShells([fallback]);
        setSelectedShell(fallback);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (availableShells.length === 0) return;
    const preferred = findPreferredShell(availableShells, settings.shellPath);
    if (preferred) setSelectedShell(preferred);
  }, [settings.shellPath, availableShells]);

  useEffect(() => {
    if (!shellPickerOpen) return;
    const close = (e: MouseEvent) => {
      if (shellPickerRef.current && !shellPickerRef.current.contains(e.target as Node)) {
        setShellPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [shellPickerOpen]);

  // ── Session state ────────────────────────────────────────────────────────
  const [isInitializing, setIsInitializing] = useState(true);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const tabCounter = useRef(0);
  const registeredIds = useRef<Set<string>>(new Set());

  // ── Split tree ───────────────────────────────────────────────────────────
  const {
    tree,
    activePaneId,
    setActivePaneId,
    moveSession,
    closePane,
    setRatios,
    setLeafSession,
    removePanesBySession,
    resetTree,
    visibleSessionIds,
  } = useSplitTree("");

  const activePaneIdRef = useRef(activePaneId);
  activePaneIdRef.current = activePaneId;
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const visibleSessionIdsRef = useRef(visibleSessionIds);
  visibleSessionIdsRef.current = visibleSessionIds;

  // ── Container size ───────────────────────────────────────────────────────
  const viewportsRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = viewportsRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Split layout (no header height — terminals use full pane) ────────────
  const layout = useMemo(
    () => computeSplitLayout(tree, 0, 0, containerSize.width, containerSize.height, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, containerSize.width, containerSize.height],
  );

  const isSplit = layout.panes.length > 1;

  // Sessions ordered by pane position (for tab group), then background sessions
  const inViewSessions = useMemo(() => {
    return layout.panes
      .map((p) => sessions.find((s) => s.id === p.sessionId))
      .filter((s): s is TerminalSession => !!s);
  }, [layout.panes, sessions]);

  const bgSessions = useMemo(
    () => sessions.filter((s) => !layout.panes.some((p) => p.sessionId === s.id)),
    [sessions, layout.panes],
  );

  // Derived: session in active pane → drives tab bar highlight
  const activeSessionId = useMemo(
    () => layout.panes.find((p) => p.leafId === activePaneId)?.sessionId ?? null,
    [layout.panes, activePaneId],
  );

  // ── Drag-drop split state ────────────────────────────────────────────────
  const [isDraggingTab, setIsDraggingTab] = useState(false);
  const [hoveredDrop, setHoveredDrop] = useState<HoveredDrop | null>(null);
  const draggingSessionIdRef = useRef<string | null>(null);

  // ── Pane enter / leave animations ───────────────────────────────────────
  const [animatingPaneIds, setAnimatingPaneIds] = useState<Set<string>>(new Set());
  const [leavingPaneIds, setLeavingPaneIds] = useState<Set<string>>(new Set());

  // ── Fit newly-visible terminals + trigger enter animation ────────────────
  const prevVisibleRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(visibleSessionIds);
    const entering: string[] = [];
    requestAnimationFrame(() => {
      for (const sid of current) {
        if (!prevVisibleRef.current.has(sid)) {
          tabRefs.current.get(sid)?.current?.fit();
          entering.push(sid);
        }
      }
      prevVisibleRef.current = current;
      if (entering.length > 0) {
        setAnimatingPaneIds(new Set(entering));
        setTimeout(() => setAnimatingPaneIds(new Set()), 260);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSessionIds.join(",")]);

  // ── Color picker ─────────────────────────────────────────────────────────
  const [colorPickerOpenId, setColorPickerOpenId] = useState<string | null>(null);
  const [colorPickerPos, setColorPickerPos] = useState<{ top: number; left: number } | null>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  // ── Interrupt policy menu ────────────────────────────────────────────────
  const [policyMenu, setPolicyMenu] = useState<{ sessionId: string; x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    if (!colorPickerOpenId) return;
    const close = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerOpenId(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [colorPickerOpenId]);

  // ── Tab bar drag-to-reorder state ────────────────────────────────────────
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  // Safety net: always clean up drag state when any drag ends on the window.
  useEffect(() => {
    const cleanup = () => {
      dragIdRef.current = null;
      draggingSessionIdRef.current = null;
      setDragId(null);
      setDragOverId(null);
      setIsDraggingTab(false);
      setHoveredDrop(null);
    };
    window.addEventListener("dragend", cleanup);
    return () => window.removeEventListener("dragend", cleanup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Context sync ─────────────────────────────────────────────────────────
  const tabRefs = useRef<Map<string, React.RefObject<TerminalTabHandle | null>>>(new Map());

  useEffect(() => {
    const currentIds = new Set(sessions.map((s) => s.id));
    registeredIds.current.forEach((id) => {
      if (!currentIds.has(id)) {
        removeTerminalSession(id);
        registeredIds.current.delete(id);
      }
    });
    sessions.forEach((s) => {
      if (!registeredIds.current.has(s.id)) {
        addTerminalSession({ ...s, workspaceId });
        registeredIds.current.add(s.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.map((s) => s.id).join(","), workspaceId]);

  useEffect(() => {
    return () => {
      registeredIds.current.forEach((id) => removeTerminalSession(id));
      registeredIds.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scope change: restore or create ─────────────────────────────────────
  const prevWorkspaceId = useRef(workspaceId);

  useEffect(() => {
    if (prevWorkspaceId.current !== workspaceId) {
      sessions.forEach((s) => invoke("kill_pty", { sessionId: s.id }).catch(() => {}));
      tabRefs.current.clear();
    }
    prevWorkspaceId.current = workspaceId;
    let cancelled = false;

    const restoreOrCreate = async () => {
      const shell = selectedShellRef.current;
      const shellPath = shell?.path ?? settings.shellPath ?? "";
      const shellArgs = shell?.args ?? [];
      const shellName = shell?.name ?? shellBasename(shellPath);
      const allTabs = await loadTerminalTabs();
      const saved = allTabs[scopeKey];
      if (cancelled) return;

      if (saved && saved.length > 0) {
        tabCounter.current = saved.length;
        const restored: TerminalSession[] = saved
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((tab, i) => {
            const newId = crypto.randomUUID();
            tabRefs.current.set(newId, React.createRef<TerminalTabHandle | null>());
            return {
              id: newId,
              title: tab.title,
              shell: tab.shell,
              shellArgs: tab.shellArgs,
              workspaceId,
              color: tab.color,
              order: i,
              interruptPolicy: "always" as const,
            };
          });
        setSessions(restored);
        resetTree(restored[0].id);
      } else {
        tabCounter.current = 1;
        const defaultId = crypto.randomUUID();
        tabRefs.current.set(defaultId, React.createRef<TerminalTabHandle | null>());
        setSessions([
          {
            id: defaultId,
            title: `${shellName} 1`,
            shell: shellPath,
            shellArgs,
            workspaceId,
            color: null,
            order: 0,
            interruptPolicy: "always",
          },
        ]);
        resetTree(defaultId);
      }

      setEditingSessionId(null);
      setIsInitializing(false);
    };

    restoreOrCreate();

    return () => {
      cancelled = true;
      setSessions((prev) => {
        prev.forEach((s) => invoke("kill_pty", { sessionId: s.id }).catch(() => {}));
        return prev;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, scopeKey]);

  // ── Save tab metadata ────────────────────────────────────────────────────
  const saveTabsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isInitializing) return;
    if (saveTabsTimer.current) clearTimeout(saveTabsTimer.current);
    saveTabsTimer.current = setTimeout(async () => {
      const allTabs = await loadTerminalTabs();
      if (sessions.length === 0) {
        delete allTabs[scopeKey];
      } else {
        allTabs[scopeKey] = sessions.map((s) => ({
          title: s.title,
          shell: s.shell,
          shellArgs: s.shellArgs,
          color: s.color,
          order: s.order,
        }));
      }
      await saveTerminalTabs(allTabs);
    }, 500);
    return () => {
      if (saveTabsTimer.current) clearTimeout(saveTabsTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, isInitializing, scopeKey]);

  // ── Tab actions ──────────────────────────────────────────────────────────

  const createNewTab = useCallback(
    (shell?: ShellInfo) => {
      const s = shell ?? selectedShellRef.current;
      const shellPath = s?.path ?? settings.shellPath ?? "";
      const shellArgs = s?.args ?? [];
      const shellName = s?.name ?? shellBasename(shellPath);
      tabCounter.current += 1;
      const newId = crypto.randomUUID();
      tabRefs.current.set(newId, React.createRef<TerminalTabHandle | null>());
      const newSession: TerminalSession = {
        id: newId,
        title: `${shellName} ${tabCounter.current}`,
        shell: shellPath,
        shellArgs,
        workspaceId,
        color: null,
        order: tabCounter.current - 1,
        interruptPolicy: "always",
      };
      setSessions((prev) => [...prev, newSession]);
      setLeafSession(activePaneIdRef.current, newId);
    },
    [settings.shellPath, workspaceId, setLeafSession],
  );

  const closeTab = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      invoke("kill_pty", { sessionId }).catch(() => {});
      tabRefs.current.delete(sessionId);
      removePanesBySession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    },
    [removePanesBySession],
  );

  const collapsePaneAnimated = useCallback(
    (leafId: string, sessionId: string) => {
      setLeavingPaneIds((prev) => new Set([...prev, sessionId]));
      setTimeout(() => {
        closePane(leafId);
        setLeavingPaneIds((prev) => { const n = new Set(prev); n.delete(sessionId); return n; });
      }, 180);
    },
    [closePane],
  );

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const switchTab = useCallback(
    (sessionId: string) => {
      // If already visible in a pane, focus that pane instead of replacing
      const existingPane = layoutRef.current.panes.find((p) => p.sessionId === sessionId);
      if (existingPane) {
        setActivePaneId(existingPane.leafId);
        requestAnimationFrame(() => tabRefs.current.get(sessionId)?.current?.focus());
        return;
      }
      // Not in any pane — show in the active pane
      setLeafSession(activePaneIdRef.current, sessionId);
      requestAnimationFrame(() => {
        const ref = tabRefs.current.get(sessionId);
        if (ref?.current) { ref.current.fit(); ref.current.focus(); }
      });
    },
    [setLeafSession, setActivePaneId],
  );

  // ── Rename ───────────────────────────────────────────────────────────────

  const startRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(id);
    setEditingTitle(currentTitle);
  };

  const saveRename = (id: string) => {
    if (editingTitle.trim()) {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: editingTitle.trim() } : s)),
      );
      updateTerminalSession(id, { title: editingTitle.trim() });
    }
    setEditingSessionId(null);
  };

  const handleRenameKeyDown = (id: string, e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveRename(id);
    else if (e.key === "Escape") setEditingSessionId(null);
  };

  // ── Color picker ─────────────────────────────────────────────────────────

  const setTabColor = (sessionId: string, color: string | null) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, color } : s)));
    updateTerminalSession(sessionId, { color });
    setColorPickerOpenId(null);
  };

  // ── Interrupt policy ─────────────────────────────────────────────────────

  const handleTabContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    setPolicyMenu({ sessionId, x: e.clientX, y: e.clientY });
  };

  const handlePolicySelect = (policy: InterruptPolicy) => {
    if (!policyMenu) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === policyMenu.sessionId ? { ...s, interruptPolicy: policy } : s)),
    );
    updateTerminalSession(policyMenu.sessionId, { interruptPolicy: policy });
    setPolicyMenu(null);
  };

  // ── Tab bar drag-to-reorder ───────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, id: string) => {
    dragIdRef.current = id;
    draggingSessionIdRef.current = id;
    setDragId(id);
    setIsDraggingTab(true);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);

    // Styled ghost — tilted clone that follows the cursor
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true) as HTMLElement;
    Object.assign(ghost.style, {
      position: "fixed",
      top: "-9999px",
      left: "-9999px",
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      transform: "rotate(-2deg) scale(1.08)",
      boxShadow: "0 10px 30px rgba(0,0,0,0.55), 0 0 0 1.5px rgba(123,104,238,0.6)",
      borderRadius: "8px",
      opacity: "1",
      pointerEvents: "none",
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragIdRef.current) setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const fromId = dragIdRef.current;
    if (!fromId || fromId === targetId) {
      dragIdRef.current = null;
      draggingSessionIdRef.current = null;
      setDragId(null);
      setDragOverId(null);
      setHoveredDrop(null);
      setIsDraggingTab(false);
      return;
    }
    const capturedFromId = fromId;
    // Dragging an in-view tab onto a background tab → detach from split
    const fromInView = visibleSessionIdsRef.current.includes(capturedFromId);
    const toInView = visibleSessionIdsRef.current.includes(targetId);
    if (fromInView && !toInView) {
      removePanesBySession(capturedFromId);
    }
    setSessions((prev) => {
      const from = prev.findIndex((s) => s.id === capturedFromId);
      const to = prev.findIndex((s) => s.id === targetId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next.map((s, i) => {
        if (s.order !== i) updateTerminalSession(s.id, { order: i });
        return { ...s, order: i };
      });
    });
    dragIdRef.current = null;
    draggingSessionIdRef.current = null;
    setDragId(null);
    setDragOverId(null);
    setHoveredDrop(null);
    setIsDraggingTab(false);
  };

  const handleDragEnd = () => {
    dragIdRef.current = null;
    draggingSessionIdRef.current = null;
    setDragId(null);
    setDragOverId(null);
    setIsDraggingTab(false);
    setHoveredDrop(null);
  };

  const handleDropOnStrip = (e: React.DragEvent) => {
    e.preventDefault();
    const fromId = dragIdRef.current;
    if (!fromId) {
      dragIdRef.current = null;
      draggingSessionIdRef.current = null;
      setDragId(null);
      setDragOverId(null);
      setHoveredDrop(null);
      setIsDraggingTab(false);
      return;
    }
    const capturedFromId = fromId;
    // Dragging an in-view tab onto the strip → detach from split
    if (visibleSessionIdsRef.current.includes(capturedFromId)) {
      removePanesBySession(capturedFromId);
    }
    setSessions((prev) => {
      const from = prev.findIndex((s) => s.id === capturedFromId);
      if (from === -1 || from === prev.length - 1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.push(moved);
      return next.map((s, i) => {
        if (s.order !== i) updateTerminalSession(s.id, { order: i });
        return { ...s, order: i };
      });
    });
    dragIdRef.current = null;
    draggingSessionIdRef.current = null;
    setDragId(null);
    setDragOverId(null);
    setHoveredDrop(null);
    setIsDraggingTab(false);
  };

  // ── Pane drop (split via drag) ────────────────────────────────────────────

  const handlePaneDrop = useCallback(
    (leafId: string, edge: DropEdge) => {
      const sessionId = draggingSessionIdRef.current;
      if (!sessionId) return;
      const before = edge === "left" || edge === "top";
      const direction = edge === "left" || edge === "right" ? "h" : "v";
      moveSession(sessionId, leafId, direction, before);
      dragIdRef.current = null;
      draggingSessionIdRef.current = null;
      setDragId(null);
      setDragOverId(null);
      setHoveredDrop(null);
      setIsDraggingTab(false);
      requestAnimationFrame(() => {
        for (const sid of visibleSessionIdsRef.current) {
          tabRefs.current.get(sid)?.current?.fit();
        }
      });
    },
    [moveSession],
  );

  // ── Divider drag resize ───────────────────────────────────────────────────

  const dividerDragRef = useRef<{
    divider: DividerRect;
    startPos: number;
    startRatios: number[];
  } | null>(null);

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent, divider: DividerRect) => {
      e.preventDefault();
      const containerNode = findNodeById(treeRef.current, divider.containerId);
      if (!containerNode || containerNode.type !== "split") return;

      dividerDragRef.current = {
        divider,
        startPos: divider.direction === "h" ? e.clientX : e.clientY,
        startRatios: [...containerNode.ratios],
      };

      const onMove = (ev: MouseEvent) => {
        const drag = dividerDragRef.current;
        if (!drag) return;
        const currentPos = drag.divider.direction === "h" ? ev.clientX : ev.clientY;
        const delta = currentPos - drag.startPos;
        const deltaRatio = delta / drag.divider.containerAvailableSize;
        const { childIndex } = drag.divider;
        const newRatios = [...drag.startRatios];
        const min = 0.05;
        newRatios[childIndex] = Math.max(min, drag.startRatios[childIndex] + deltaRatio);
        newRatios[childIndex + 1] = Math.max(min, drag.startRatios[childIndex + 1] - deltaRatio);
        const sum = newRatios.reduce((a, b) => a + b, 0);
        setRatios(
          drag.divider.containerId,
          newRatios.map((r) => r / sum),
        );
      };

      const onUp = () => {
        dividerDragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        requestAnimationFrame(() => {
          for (const sid of visibleSessionIdsRef.current) {
            tabRefs.current.get(sid)?.current?.fit();
          }
        });
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [setRatios],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.container}>
      {/* Tab bar */}
      <div
        className={styles.header}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropOnStrip}
      >
        <div className={styles.tabsList} onDragOver={(e) => e.preventDefault()}>
          {/* In-view group — only shown in split mode */}
          {isSplit && inViewSessions.length > 0 && (
            <div className={styles.tabGroup}>
              {inViewSessions.map((session, groupIdx) => {
                const isActive = session.id === activeSessionId;
                const isEditing = session.id === editingSessionId;
                const isDragging = session.id === dragId;
                const isDragOver = session.id === dragOverId;
                const tabColor = session.color ?? "#7B68EE";
                const isColorPickerOpen = session.id === colorPickerOpenId;
                return (
                  <div
                    key={session.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, session.id)}
                    onDragOver={(e) => handleDragOver(e, session.id)}
                    onDrop={(e) => handleDrop(e, session.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => switchTab(session.id)}
                    onContextMenu={(e) => handleTabContextMenu(e, session.id)}
                    className={cx(
                      styles.tab,
                      styles.groupedTab,
                      isActive ? styles.groupedActiveTab : styles.groupedInactiveTab,
                      isDragging && styles.tabDragging,
                      isDragOver && styles.tabDragOver,
                    )}
                    style={isActive ? { borderTopColor: tabColor } : undefined}
                  >
                    <span className={cx(styles.paneBadge, isActive ? styles.paneBadgeActive : styles.paneBadgeInactive)}>{groupIdx + 1}</span>
                    <div
                      className={styles.colorDotWrapper}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isColorPickerOpen) {
                          setColorPickerOpenId(null);
                        } else {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setColorPickerPos({ top: rect.bottom + 8, left: rect.left - 4 });
                          setColorPickerOpenId(session.id);
                        }
                      }}
                    >
                      <span
                        className={cx(styles.colorDot, isActive && styles.colorDotActive)}
                        style={{ backgroundColor: session.color ?? (isActive ? "var(--color-brand)" : "var(--bg-tertiary)") }}
                        title="Change tab color"
                      />
                    </div>
                    {isEditing ? (
                      <Input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => saveRename(session.id)}
                        onKeyDown={(e) => handleRenameKeyDown(session.id, e)}
                        className={styles.renameInput}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => startRename(session.id, session.title, e)}
                        className={styles.tabTitle}
                        title={`${session.title} — double-click to rename`}
                      >
                        {session.title}
                      </span>
                    )}
                    <div className={cx(styles.tabActions, "tab-actions-btn-group")}>
                      {!isEditing && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); startRename(session.id, session.title, e); }} className={styles.tabActionBtn} title="Rename tab">
                            <Edit2 className={styles.tinyIcon} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isColorPickerOpen) { setColorPickerOpenId(null); }
                              else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setColorPickerPos({ top: rect.bottom + 8, left: rect.left - 4 });
                                setColorPickerOpenId(session.id);
                              }
                            }}
                            className={styles.tabActionBtn} title="Change tab color"
                          >
                            <Palette className={styles.tinyIcon} />
                          </button>
                        </>
                      )}
                      <button onClick={(e) => closeTab(session.id, e)} className={styles.closeTabBtn} title="Close tab">
                        <X className={styles.tinyIcon} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Separator between groups */}
          {isSplit && inViewSessions.length > 0 && bgSessions.length > 0 && (
            <div className={styles.tabGroupSep} />
          )}

          {/* Background tabs (or all tabs in single-pane mode) */}
          {(isSplit ? bgSessions : sessions).map((session) => {
            const isActive = session.id === activeSessionId;
            const isEditing = session.id === editingSessionId;
            const isDragging = session.id === dragId;
            const isDragOver = session.id === dragOverId;
            const tabColor = session.color ?? "#7B68EE";
            const isColorPickerOpen = session.id === colorPickerOpenId;
            return (
              <div
                key={session.id}
                draggable
                onDragStart={(e) => handleDragStart(e, session.id)}
                onDragOver={(e) => handleDragOver(e, session.id)}
                onDrop={(e) => handleDrop(e, session.id)}
                onDragEnd={handleDragEnd}
                onClick={() => switchTab(session.id)}
                onContextMenu={(e) => handleTabContextMenu(e, session.id)}
                className={cx(
                  styles.tab,
                  isActive ? styles.activeTab : styles.inactiveTab,
                  isDragging && styles.tabDragging,
                  isDragOver && styles.tabDragOver,
                )}
                style={isActive ? { borderTopColor: tabColor } : undefined}
              >
                <div
                  className={styles.colorDotWrapper}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isColorPickerOpen) {
                      setColorPickerOpenId(null);
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setColorPickerPos({ top: rect.bottom + 8, left: rect.left - 4 });
                      setColorPickerOpenId(session.id);
                    }
                  }}
                >
                  <span
                    className={cx(styles.colorDot, isActive && styles.colorDotActive)}
                    style={{ backgroundColor: session.color ?? (isActive ? "var(--color-brand)" : "var(--bg-tertiary)") }}
                    title="Change tab color"
                  />
                </div>
                {isEditing ? (
                  <Input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => saveRename(session.id)}
                    onKeyDown={(e) => handleRenameKeyDown(session.id, e)}
                    className={styles.renameInput}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => startRename(session.id, session.title, e)}
                    className={styles.tabTitle}
                    title={`${session.title} — double-click to rename`}
                  >
                    {session.title}
                  </span>
                )}
                <div className={cx(styles.tabActions, "tab-actions-btn-group")}>
                  {!isEditing && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); startRename(session.id, session.title, e); }} className={styles.tabActionBtn} title="Rename tab">
                        <Edit2 className={styles.tinyIcon} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isColorPickerOpen) { setColorPickerOpenId(null); }
                          else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setColorPickerPos({ top: rect.bottom + 8, left: rect.left - 4 });
                            setColorPickerOpenId(session.id);
                          }
                        }}
                        className={styles.tabActionBtn} title="Change tab color"
                      >
                        <Palette className={styles.tinyIcon} />
                      </button>
                    </>
                  )}
                  <button onClick={(e) => closeTab(session.id, e)} className={styles.closeTabBtn} title="Close tab">
                    <X className={styles.tinyIcon} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.newTabWrapper}>
          <button
            className={styles.newTabBtn}
            title={`New tab${selectedShell ? ` (${selectedShell.name})` : ""}`}
            onClick={() => createNewTab()}
          >
            <Plus className={styles.smallIcon} />
          </button>
          {availableShells.length > 1 && (
            <button
              className={styles.shellToggleBtn}
              title="Choose shell"
              onClick={(e) => {
                if (shellPickerOpen) {
                  setShellPickerOpen(false);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setShellDropdownPos({ top: rect.bottom + 6, left: rect.right - 240 });
                  setShellPickerOpen(true);
                }
              }}
            >
              <ChevronDown className={styles.tinyIcon} />
            </button>
          )}
        </div>

        <div className={styles.headerSpacer} />
      </div>

      {/* Portals */}
      {colorPickerOpenId &&
        colorPickerPos &&
        (() => {
          const pickerSession = sessions.find((s) => s.id === colorPickerOpenId);
          if (!pickerSession) return null;
          return createPortal(
            <div
              ref={colorPickerRef}
              className={styles.colorPickerPopover}
              style={{ top: colorPickerPos.top, left: colorPickerPos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.colorPickerLabel}>Tab color</div>
              <div className={styles.colorSwatches}>
                {TAB_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    className={cx(
                      styles.colorSwatch,
                      pickerSession.color === c && styles.colorSwatchActive,
                    )}
                    style={{ backgroundColor: c }}
                    onClick={() => setTabColor(pickerSession.id, c)}
                    title={c}
                  />
                ))}
                {pickerSession.color && (
                  <button
                    className={styles.colorSwatchReset}
                    onClick={() => setTabColor(pickerSession.id, null)}
                    title="Reset"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>,
            document.body,
          );
        })()}

      {shellPickerOpen &&
        shellDropdownPos &&
        createPortal(
          <div
            ref={shellPickerRef}
            className={styles.shellDropdown}
            style={{ top: shellDropdownPos.top, left: shellDropdownPos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.shellDropdownHeader}>New tab with</div>
            {availableShells.map((shell) => {
              const isLastUsed =
                shell.path === selectedShell?.path && shell.name === selectedShell?.name;
              return (
                <button
                  key={shell.path + shell.name}
                  className={cx(
                    styles.shellDropdownItem,
                    isLastUsed && styles.shellDropdownItemActive,
                  )}
                  onClick={() => {
                    setSelectedShell(shell);
                    setShellPickerOpen(false);
                    createNewTab(shell);
                  }}
                >
                  <Terminal className={styles.shellItemIcon} />
                  <span className={styles.shellItemName}>{shell.name}</span>
                  <span className={styles.shellItemPath}>{shell.path}</span>
                  {isLastUsed && <Check className={styles.shellItemCheck} />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}

      {policyMenu &&
        createPortal(
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 99 }}
              onClick={() => setPolicyMenu(null)}
            />
            <div
              style={{
                position: "fixed",
                top: policyMenu.y,
                left: policyMenu.x,
                zIndex: 100,
                background: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: 6,
                padding: "4px 0",
                minWidth: 210,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                fontSize: 12,
              }}
            >
              <div
                style={{
                  padding: "4px 12px 6px",
                  fontSize: 10,
                  color: "var(--text-tertiary)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Auto-inject policy
              </div>
              {(["never", "prompt-only", "always"] as const).map((policy) => {
                const sess = sessions.find((s) => s.id === policyMenu.sessionId);
                const active = sess?.interruptPolicy === policy;
                const labels: Record<InterruptPolicy, string> = {
                  never: "🔒 Never — block all injections",
                  "prompt-only": "⏸ Prompt only — wait for idle",
                  always: "⚡ Always — inject immediately",
                };
                return (
                  <button
                    key={policy}
                    onClick={() => handlePolicySelect(policy)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 12px",
                      background: active ? "rgba(123,104,238,0.12)" : "transparent",
                      border: "none",
                      color: active ? "var(--color-brand)" : "var(--text-secondary)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: active ? 700 : 400,
                    }}
                  >
                    {labels[policy]}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}

      {/* Terminal viewports */}
      <div className={styles.viewports} ref={viewportsRef}>
        {!isInitializing && sessions.length === 0 ? (
          <div className={styles.emptyState}>
            <Terminal className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No active terminal sessions</p>
            <p className={styles.emptyDesc}>
              Pick a shell and launch a session for this workspace.
            </p>
            <button onClick={() => createNewTab()} className={styles.launchBtn}>
              <Plus className={styles.smallIcon} />
              <span>Launch Terminal Session</span>
            </button>
          </div>
        ) : (
          <>
            {/* All terminals — absolute positioned so PTYs stay alive */}
            {sessions.map((session) => {
              const pane = layout.panes.find((p) => p.sessionId === session.id);
              const tabRef = tabRefs.current.get(session.id) ?? null;
              const isActivePane = isSplit && pane?.leafId === activePaneId;
              return (
                <div
                  key={session.id}
                  className={cx(
                    pane ? styles.paneWrapper : undefined,
                    pane && animatingPaneIds.has(session.id) && styles.paneEntering,
                    pane && leavingPaneIds.has(session.id) && styles.paneLeaving,
                  )}
                  style={
                    pane
                      ? {
                          position: "absolute",
                          top: pane.top,
                          left: pane.left,
                          width: pane.width,
                          height: pane.height,
                          zIndex: 1,
                        }
                      : {
                          position: "absolute",
                          visibility: "hidden",
                          pointerEvents: "none",
                          inset: 0,
                        }
                  }
                  onClick={() => {
                    if (pane) {
                      setActivePaneId(pane.leafId);
                      tabRefs.current.get(session.id)?.current?.focus();
                    }
                  }}
                >
                  <TerminalTab
                    ref={tabRef}
                    sessionId={session.id}
                    workspacePath={workspacePath}
                    shell={session.shell}
                    shellArgs={session.shellArgs}
                  />
                  {isSplit && pane && (
                    <>
                      {isActivePane && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            border: "1.5px solid var(--color-brand)",
                            pointerEvents: "none",
                            zIndex: 25,
                            boxSizing: "border-box",
                          }}
                        />
                      )}
                      <button
                        data-pane-close=""
                        className={styles.paneCloseBtn}
                        style={{ position: "absolute", top: 4, right: 4, zIndex: 26 }}
                        title="Collapse to tab"
                        onClick={(e) => { e.stopPropagation(); collapsePaneAnimated(pane.leafId, session.id); }}
                      >
                        <Minimize2 style={{ width: 11, height: 11 }} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}

            {/* Drag-resize dividers */}
            {layout.dividers.map((div) => (
              <div
                key={`${div.containerId}-${div.childIndex}`}
                className={cx(
                  styles.divider,
                  div.direction === "h" ? styles.dividerH : styles.dividerV,
                )}
                style={{
                  position: "absolute",
                  top: div.top,
                  left: div.left,
                  width: div.width,
                  height: div.height,
                  zIndex: 30,
                }}
                onMouseDown={(e) => handleDividerMouseDown(e, div)}
              />
            ))}

            {/* Drop zones — visible arrow indicators at pane edges during drag */}
            {isDraggingTab &&
              layout.panes.filter((pane) => pane.sessionId !== draggingSessionIdRef.current).map((pane) => {
                const W = pane.width;
                const H = pane.height;
                const eW = W * DROP_EDGE_FRACTION;
                const eH = H * DROP_EDGE_FRACTION;

                const zones: { edge: DropEdge; top: number; left: number; width: number; height: number; }[] = [
                  { edge: "left",   top: pane.top,           left: pane.left,          width: eW,          height: H   },
                  { edge: "right",  top: pane.top,           left: pane.left + W - eW, width: eW,          height: H   },
                  { edge: "top",    top: pane.top,           left: pane.left + eW,     width: W - 2 * eW,  height: eH  },
                  { edge: "bottom", top: pane.top + H - eH,  left: pane.left + eW,     width: W - 2 * eW,  height: eH  },
                ];

                return zones.map((z) => (
                  <div
                    key={`zone-${pane.leafId}-${z.edge}`}
                    style={{ position: "absolute", top: z.top, left: z.left, width: z.width, height: z.height, zIndex: 50 }}
                    onDragOver={(e) => { e.preventDefault(); setHoveredDrop({ leafId: pane.leafId, edge: z.edge }); }}
                    onDragLeave={() => setHoveredDrop(null)}
                    onDrop={(e) => { e.preventDefault(); handlePaneDrop(pane.leafId, z.edge); }}
                  />
                ));
              })}

            {/* Drop indicator — animated preview of where new pane will appear */}
            {hoveredDrop &&
              (() => {
                const pane = layout.panes.find((p) => p.leafId === hoveredDrop.leafId);
                if (!pane) return null;
                const { edge } = hoveredDrop;
                const hw = pane.width / 2;
                const hh = pane.height / 2;
                const ind: Record<DropEdge, React.CSSProperties> = {
                  left:   { top: pane.top,        left: pane.left,      width: hw,         height: pane.height },
                  right:  { top: pane.top,        left: pane.left + hw, width: hw,         height: pane.height },
                  top:    { top: pane.top,        left: pane.left,      width: pane.width, height: hh          },
                  bottom: { top: pane.top + hh,   left: pane.left,      width: pane.width, height: hh          },
                };
                return (
                  <div
                    key={`${hoveredDrop.leafId}-${edge}`}
                    className={styles.dropIndicator}
                    style={{ position: "absolute", ...ind[edge], pointerEvents: "none", zIndex: 40 }}
                  />
                );
              })()}
          </>
        )}
      </div>
    </div>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = {
  container: css`
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-canvas);
    overflow: hidden;
  `,
  header: css`
    display: flex;
    align-items: flex-end;
    background-color: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    user-select: none;
    flex-shrink: 0;
  `,
  tabsList: css`
    display: flex;
    align-items: flex-end;
    overflow-x: auto;
    padding-top: 8px;
    gap: 4px;
    min-width: 0;
    &::-webkit-scrollbar {
      display: none;
    }
    scrollbar-width: none;
  `,
  tab: css`
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 700;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    border-top: 2px solid transparent;
    cursor: pointer;
    transition: all 150ms ease;
    user-select: none;
    flex-shrink: 0;
    position: relative;
    &:hover .tab-actions-btn-group {
      opacity: 1;
    }
  `,
  activeTab: css`
    background-color: var(--bg-canvas);
    color: var(--text-primary);
  `,
  inactiveTab: css`
    background-color: transparent;
    color: var(--text-tertiary);
    &:hover {
      background-color: var(--bg-hover);
      color: var(--text-secondary);
    }
  `,
  tabGroup: css`
    display: flex;
    align-items: flex-end;
    gap: 0;
    position: relative;
    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--color-brand);
      border-radius: 1px 1px 0 0;
      opacity: 0.45;
      pointer-events: none;
    }
  `,
  groupedTab: css`
    margin: 0 1px 0 0;
    &:last-child { margin-right: 0; }
  `,
  groupedActiveTab: css`
    background-color: rgba(123, 104, 238, 0.2);
    color: var(--text-primary);
    &:hover {
      background-color: rgba(123, 104, 238, 0.25);
    }
  `,
  groupedInactiveTab: css`
    background-color: transparent;
    color: var(--text-tertiary);
    &:hover {
      background-color: rgba(123, 104, 238, 0.07);
      color: var(--text-secondary);
    }
  `,
  paneBadge: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    font-size: 8px;
    font-weight: 800;
    flex-shrink: 0;
    letter-spacing: -0.5px;
    transition: all 150ms ease;
  `,
  paneBadgeActive: css`
    background: var(--color-brand);
    color: #fff;
  `,
  paneBadgeInactive: css`
    background: transparent;
    color: rgba(123, 104, 238, 0.5);
    border: 1.5px solid rgba(123, 104, 238, 0.28);
  `,
  tabGroupSep: css`
    width: 1px;
    height: 18px;
    background: var(--border-color-hover);
    align-self: center;
    margin: 0 6px;
    flex-shrink: 0;
    opacity: 0.5;
  `,
  tabDragging: css`
    opacity: 0.3;
    cursor: grabbing;
  `,
  tabDragOver: css`
    box-shadow: -3px 0 0 0 var(--color-brand);
    animation: tabNudge 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
    @keyframes tabNudge {
      0%   { transform: translateX(0); }
      40%  { transform: translateX(-5px); }
      100% { transform: translateX(0); }
    }
  `,
  dropIndicator: css`
    background: rgba(123, 104, 238, 0.16);
    border: 2px solid var(--color-brand);
    box-sizing: border-box;
    border-radius: 4px;
    animation: dropSnap 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: inset 0 0 20px rgba(123, 104, 238, 0.1), 0 0 12px rgba(123, 104, 238, 0.3);
    @keyframes dropSnap {
      from { opacity: 0; transform: scale(0.94); }
      to   { opacity: 1; transform: scale(1); }
    }
  `,
  colorDotWrapper: css`
    flex-shrink: 0;
    display: flex;
    align-items: center;
    cursor: pointer;
  `,
  colorDot: css`
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    cursor: pointer;
    transition:
      transform 150ms ease,
      box-shadow 150ms ease;
    &:hover {
      transform: scale(1.4);
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.15);
    }
  `,
  colorDotActive: css`
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.1);
  `,
  colorPickerPopover: css`
    position: fixed;
    z-index: 9999;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color-hover);
    border-radius: 10px;
    padding: 10px 12px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
    animation: popIn 120ms ease-out;
    @keyframes popIn {
      from {
        opacity: 0;
        transform: scale(0.92) translateY(-4px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
  `,
  colorPickerLabel: css`
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    margin-bottom: 8px;
    white-space: nowrap;
  `,
  colorSwatches: css`
    display: flex;
    gap: 6px;
    align-items: center;
  `,
  colorSwatch: css`
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition:
      transform 120ms ease,
      border-color 120ms ease;
    flex-shrink: 0;
    padding: 0;
    &:hover {
      transform: scale(1.25);
    }
  `,
  colorSwatchActive: css`
    border-color: rgba(255, 255, 255, 0.8);
    transform: scale(1.15);
  `,
  colorSwatchReset: css`
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid var(--border-color-hover);
    background: var(--bg-canvas);
    color: var(--text-tertiary);
    font-size: 9px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    transition: all 120ms ease;
    &:hover {
      border-color: #ef4444;
      color: #ef4444;
    }
  `,
  renameInput: css`
    background-color: var(--bg-canvas);
    border: 1px solid var(--border-color-hover);
    color: var(--text-primary);
    border-radius: 4px;
    padding: 2px 4px;
    width: 96px;
    outline: none;
    font-size: 11px;
  `,
  tabTitle: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  `,
  tabActions: css`
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    margin-left: 2px;
    transition: opacity 150ms ease;
  `,
  tabActionBtn: css`
    padding: 2px;
    border-radius: 4px;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 150ms ease;
    display: flex;
    align-items: center;
    justify-content: center;
    &:hover {
      background-color: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  closeTabBtn: css`
    padding: 2px;
    border-radius: 4px;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 150ms ease;
    display: flex;
    align-items: center;
    justify-content: center;
    &:hover {
      background-color: rgba(244, 63, 94, 0.15);
      color: #fb7185;
    }
  `,
  newTabWrapper: css`
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: flex-end;
    padding-bottom: 2px;
    padding-left: 2px;
  `,
  headerSpacer: css`
    flex: 1;
    min-width: 8px;
  `,
  shellDropdown: css`
    position: fixed;
    z-index: 9999;
    min-width: 240px;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color-hover);
    border-radius: 10px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: fadeDropdown 120ms ease-out;
    @keyframes fadeDropdown {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `,
  shellDropdownHeader: css`
    padding: 8px 12px 4px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
  `,
  shellDropdownItem: css`
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 100ms ease;
    text-align: left;
    &:hover {
      background-color: var(--bg-hover);
    }
  `,
  shellDropdownItemActive: css`
    background-color: rgba(123, 104, 238, 0.1);
  `,
  shellItemIcon: css`
    width: 13px;
    height: 13px;
    color: var(--color-brand);
    flex-shrink: 0;
  `,
  shellItemName: css`
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  shellItemPath: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: var(--font-family-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80px;
  `,
  shellItemCheck: css`
    width: 12px;
    height: 12px;
    color: var(--color-brand);
    flex-shrink: 0;
  `,
  newTabBtn: css`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      color 150ms ease,
      background-color 150ms ease;
    &:hover {
      color: var(--color-brand);
      background-color: var(--bg-hover);
    }
  `,
  shellToggleBtn: css`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: color 150ms ease;
    &:hover {
      color: var(--color-brand);
    }
  `,
  viewports: css`
    flex: 1;
    background-color: var(--bg-canvas);
    min-height: 0;
    position: relative;
  `,
  divider: css`
    background: var(--border-color);
    transition: background 150ms ease;
    animation: dividerAppear 220ms ease-out;
    @keyframes dividerAppear {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    &:hover {
      background: var(--color-brand);
    }
  `,
  dividerH: css`
    cursor: col-resize;
  `,
  dividerV: css`
    cursor: row-resize;
  `,
  paneWrapper: css`
    &:hover [data-pane-close] {
      opacity: 1;
    }
  `,
  paneEntering: css`
    animation: paneAppear 240ms cubic-bezier(0.16, 1, 0.3, 1);
    @keyframes paneAppear {
      from { opacity: 0; transform: scale(0.97); }
      to   { opacity: 1; transform: scale(1); }
    }
  `,
  paneLeaving: css`
    animation: paneLeave 175ms ease-in forwards;
    pointer-events: none;
    @keyframes paneLeave {
      from { opacity: 1; transform: scale(1); }
      to   { opacity: 0; transform: scale(0.97); }
    }
  `,
  paneCloseBtn: css`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--text-secondary);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 150ms ease,
      background 150ms ease,
      color 150ms ease;
    &:hover {
      background: rgba(123, 104, 238, 0.45);
      color: var(--color-brand);
      border-color: rgba(123, 104, 238, 0.4);
    }
  `,
  emptyState: css`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px;
    text-align: center;
  `,
  emptyIcon: css`
    width: 40px;
    height: 40px;
    color: var(--text-tertiary);
    margin-bottom: 14px;
    opacity: 0.5;
  `,
  emptyTitle: css`
    font-weight: 700;
    color: var(--text-secondary);
    font-size: 14px;
    margin: 0;
  `,
  emptyDesc: css`
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 5px;
    margin-bottom: 20px;
    line-height: 1.5;
  `,
  launchBtn: css`
    display: flex;
    align-items: center;
    gap: 7px;
    background: var(--gradient-brand);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    padding: 9px 18px;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(123, 104, 238, 0.3);
    transition:
      box-shadow 0.2s,
      filter 0.2s;
    &:hover {
      box-shadow: 0 6px 20px rgba(123, 104, 238, 0.4);
      filter: brightness(1.06);
    }
  `,
  tinyIcon: css`
    width: 10px;
    height: 10px;
  `,
  smallIcon: css`
    width: 13px;
    height: 13px;
  `,
};
