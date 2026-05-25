import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { TerminalTab, TerminalTabHandle } from './TerminalTab';
import { useDashboard } from '../../context/DashboardContext';
import { invoke } from '@tauri-apps/api/core';
import { Plus, X, Terminal, Edit2, Check, Palette, ChevronDown } from 'lucide-react';
import { css, cx } from '@emotion/css';
import type { TerminalSession } from '../../types';
import { loadTerminalTabs, saveTerminalTabs } from '../../services/storage';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ShellInfo {
  name: string;
  path: string;
  args: string[];
}

interface TerminalContainerProps {
  workspaceId: string;
  workspacePath: string;
  /** Stable key for this scope (workspaceId::spaceId or workspaceId::workspace).
   *  Used to save/restore tab metadata per scope. */
  scopeKey: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TAB_COLOR_PRESETS = [
  '#7B68EE', // brand purple (default)
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#06b6d4', // cyan
  '#84cc16', // lime
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function shellBasename(path: string): string {
  const part = path.replace(/\\/g, '/').split('/').pop() ?? path;
  return part.replace(/\.(exe|cmd|bat|sh)$/i, '');
}

// ── Component ──────────────────────────────────────────────────────────────────

export const TerminalContainer: React.FC<TerminalContainerProps> = ({
  workspaceId,
  workspacePath,
  scopeKey,
}) => {
  const { settings, addTerminalSession, removeTerminalSession, updateTerminalSession } = useDashboard();

  // ── Shell detection ──────────────────────────────────────────────────────
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);
  const [selectedShell, setSelectedShell] = useState<ShellInfo | null>(null);
  const [shellPickerOpen, setShellPickerOpen] = useState(false);
  const [shellDropdownPos, setShellDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const shellPickerRef = useRef<HTMLDivElement>(null);
  const selectedShellRef = useRef<ShellInfo | null>(null);
  selectedShellRef.current = selectedShell;

  useEffect(() => {
    invoke<ShellInfo[]>('get_available_shells')
      .then((shells) => {
        if (shells.length === 0) return;
        setAvailableShells(shells);
        const preferred = shells.find(
          (s) =>
            s.path === settings.shellPath ||
            s.name.toLowerCase().includes(shellBasename(settings.shellPath).toLowerCase()),
        );
        setSelectedShell(preferred ?? shells[0]);
      })
      .catch(() => {
        const fallback: ShellInfo = {
          name: shellBasename(settings.shellPath) || 'Shell',
          path: settings.shellPath || 'powershell',
          args: [],
        };
        setAvailableShells([fallback]);
        setSelectedShell(fallback);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!shellPickerOpen) return;
    const close = (e: MouseEvent) => {
      if (shellPickerRef.current && !shellPickerRef.current.contains(e.target as Node)) {
        setShellPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [shellPickerOpen]);

  // ── Session state ────────────────────────────────────────────────────────
  // isInitializing stays true until the first default tab is created.
  // This prevents the empty-state card from flashing during remount.
  const [isInitializing, setIsInitializing] = useState(true);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSessionId;
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const tabCounter = useRef(0);
  const registeredIds = useRef<Set<string>>(new Set());

  // ── Color picker state ───────────────────────────────────────────────────
  const [colorPickerOpenId, setColorPickerOpenId] = useState<string | null>(null);
  const [colorPickerPos, setColorPickerPos]       = useState<{ top: number; left: number } | null>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colorPickerOpenId) return;
    const close = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerOpenId(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [colorPickerOpenId]);

  // ── Drag-to-reorder state ────────────────────────────────────────────────
  const [dragId, setDragId]     = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Ref keeps the dragged ID stable across renders so handlers never read a stale closure.
  const dragIdRef = useRef<string | null>(null);

  // ── Context sync ─────────────────────────────────────────────────────────
  const tabRefs = useRef<Map<string, React.RefObject<TerminalTabHandle | null>>>(new Map());

  useEffect(() => {
    const currentIds = new Set(sessions.map(s => s.id));
    registeredIds.current.forEach(id => {
      if (!currentIds.has(id)) {
        removeTerminalSession(id);
        registeredIds.current.delete(id);
      }
    });
    sessions.forEach(s => {
      if (!registeredIds.current.has(s.id)) {
        addTerminalSession({ ...s, workspaceId });
        registeredIds.current.add(s.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.map(s => s.id).join(','), workspaceId]);

  useEffect(() => {
    return () => {
      registeredIds.current.forEach(id => removeTerminalSession(id));
      registeredIds.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scope change: restore saved tabs or create default ──────────────────
  // Runs on mount (and whenever workspaceId changes, though the component is
  // re-keyed from above so that is equivalent to a remount).
  const prevWorkspaceId = useRef(workspaceId);

  useEffect(() => {
    if (prevWorkspaceId.current !== workspaceId) {
      sessions.forEach((s) => {
        invoke('kill_pty', { sessionId: s.id }).catch(() => {});
      });
      tabRefs.current.clear();
    }
    prevWorkspaceId.current = workspaceId;

    let cancelled = false;

    const restoreOrCreate = async () => {
      const shell = selectedShellRef.current;
      const shellPath = shell?.path ?? settings.shellPath ?? 'powershell';
      const shellArgs = shell?.args ?? [];
      const shellName = shell?.name ?? shellBasename(shellPath);

      // Try to restore previously saved tabs for this scope.
      const allTabs = await loadTerminalTabs();
      const saved = allTabs[scopeKey];

      if (cancelled) return;

      if (saved && saved.length > 0) {
        // Restore saved layout — fresh IDs, same metadata.
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
            };
          });
        setSessions(restored);
        setActiveSessionId(restored[0].id);
      } else {
        // No saved state — create a single default tab.
        tabCounter.current = 1;
        const defaultId = crypto.randomUUID();
        tabRefs.current.set(defaultId, React.createRef<TerminalTabHandle | null>());
        setSessions([{ id: defaultId, title: `${shellName} 1`, shell: shellPath, shellArgs, workspaceId, color: null, order: 0 }]);
        setActiveSessionId(defaultId);
      }

      setEditingSessionId(null);
      setIsInitializing(false);
    };

    restoreOrCreate();

    return () => {
      cancelled = true;
      setSessions((prev) => {
        prev.forEach((s) => invoke('kill_pty', { sessionId: s.id }).catch(() => {}));
        return prev;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, scopeKey]);

  // ── Save tab metadata whenever sessions change ────────────────────────────
  const saveTabsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isInitializing) return; // skip until the first tab batch is ready
    if (saveTabsTimer.current) clearTimeout(saveTabsTimer.current);
    saveTabsTimer.current = setTimeout(async () => {
      const allTabs = await loadTerminalTabs();
      if (sessions.length === 0) {
        // All tabs closed — remove scope entry so next open starts fresh.
        delete allTabs[scopeKey];
      } else {
        allTabs[scopeKey] = sessions.map(s => ({
          title: s.title,
          shell: s.shell,
          shellArgs: s.shellArgs,
          color: s.color,
          order: s.order,
        }));
      }
      await saveTerminalTabs(allTabs);
    }, 500);
    return () => { if (saveTabsTimer.current) clearTimeout(saveTabsTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, isInitializing, scopeKey]);

  // ── Tab actions ──────────────────────────────────────────────────────────

  const createNewTab = useCallback((shell?: ShellInfo) => {
    const s = shell ?? selectedShellRef.current;
    const shellPath = s?.path ?? settings.shellPath ?? 'powershell';
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
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newId);
  }, [settings.shellPath, workspaceId]);

  const closeTab = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      invoke('kill_pty', { sessionId }).catch(() => {});
      tabRefs.current.delete(sessionId);
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== sessionId);
        if (activeSessionIdRef.current === sessionId) {
          setActiveSessionId(next.length > 0 ? next[next.length - 1].id : null);
        }
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const switchTab = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    requestAnimationFrame(() => {
      const ref = tabRefs.current.get(sessionId);
      if (ref?.current) ref.current.fit();
    });
  }, []);

  // ── Rename logic ─────────────────────────────────────────────────────────

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
    if (e.key === 'Enter') saveRename(id);
    else if (e.key === 'Escape') setEditingSessionId(null);
  };

  // ── Color picker logic ────────────────────────────────────────────────────

  const setTabColor = (sessionId: string, color: string | null) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, color } : s)),
    );
    updateTerminalSession(sessionId, { color });
    setColorPickerOpenId(null);
  };

  // ── Drag-to-reorder logic ─────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, id: string) => {
    // Write to ref immediately — state update is async and closures could be stale.
    dragIdRef.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Required by some browsers to enable the drop event.
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== dragIdRef.current) setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const fromId = dragIdRef.current;
    if (!fromId || fromId === targetId) {
      dragIdRef.current = null;
      setDragId(null);
      setDragOverId(null);
      return;
    }

    // Capture fromId in local var so the functional updater never touches the ref.
    const capturedFromId = fromId;
    setSessions((prev) => {
      const from = prev.findIndex((s) => s.id === capturedFromId);
      const to   = prev.findIndex((s) => s.id === targetId);
      if (from === -1 || to === -1) return prev;

      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Re-assign order fields and sync to context.
      return next.map((s, i) => {
        if (s.order !== i) updateTerminalSession(s.id, { order: i });
        return { ...s, order: i };
      });
    });

    dragIdRef.current = null;
    setDragId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    dragIdRef.current = null;
    setDragId(null);
    setDragOverId(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.container}>
      {/* Tabs Header */}
      <div className={styles.header}>
        <div className={styles.tabsList}>
          {sessions.map((session) => {
            const isActive   = session.id === activeSessionId;
            const isEditing  = session.id === editingSessionId;
            const isDragging = session.id === dragId;
            const isDragOver = session.id === dragOverId;
            const tabColor   = session.color ?? '#7B68EE';
            const isColorPickerOpen = session.id === colorPickerOpenId;

            return (
              <div
                key={session.id}
                draggable
                onDragStart={(e) => handleDragStart(e, session.id)}
                onDragOver={(e)  => handleDragOver(e, session.id)}
                onDrop={(e)      => handleDrop(e, session.id)}
                onDragEnd={handleDragEnd}
                onClick={() => switchTab(session.id)}
                className={cx(
                  styles.tab,
                  isActive   ? styles.activeTab    : styles.inactiveTab,
                  isDragging && styles.tabDragging,
                  isDragOver && styles.tabDragOver,
                )}
                style={isActive ? { borderTopColor: tabColor } : undefined}
              >
                {/* Color dot */}
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
                    style={{ backgroundColor: session.color ?? (isActive ? 'var(--color-brand)' : 'var(--bg-tertiary)') }}
                    title="Change tab color"
                  />

                </div>

                {isEditing ? (
                  <input
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

                <div className={cx(styles.tabActions, 'tab-actions-btn-group')}>
                  {!isEditing && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(session.id, session.title, e);
                        }}
                        className={styles.tabActionBtn}
                        title="Rename tab"
                      >
                        <Edit2 className={styles.tinyIcon} />
                      </button>
                      <button
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
                        className={styles.tabActionBtn}
                        title="Change tab color"
                      >
                        <Palette className={styles.tinyIcon} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={(e) => closeTab(session.id, e)}
                    className={styles.closeTabBtn}
                    title="Close tab"
                  >
                    <X className={styles.tinyIcon} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* New-tab controls — flush after the last tab */}
        <div className={styles.newTabWrapper}>
          {/* + creates a tab with the last-used shell immediately */}
          <button
            className={styles.newTabBtn}
            title={`New tab${selectedShell ? ` (${selectedShell.name})` : ''}`}
            onClick={() => createNewTab()}
          >
            <Plus className={styles.smallIcon} />
          </button>

          {/* ▾ opens the shell picker — only shown when there are multiple shells */}
          {availableShells.length > 1 && (
            <button
              className={styles.shellToggleBtn}
              title="Choose shell"
              onClick={(e) => {
                if (shellPickerOpen) {
                  setShellPickerOpen(false);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setShellDropdownPos({
                    top:  rect.bottom + 6,
                    left: rect.right - 240,
                  });
                  setShellPickerOpen(true);
                }
              }}
            >
              <ChevronDown className={styles.tinyIcon} />
            </button>
          )}
        </div>

        {/* absorbs remaining space so tabs don't stretch */}
        <div className={styles.headerSpacer} />
      </div>

      {/* Color picker portal — rendered at document.body to escape overflow clip */}
      {colorPickerOpenId && colorPickerPos && (() => {
        const pickerSession = sessions.find(s => s.id === colorPickerOpenId);
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
                  title="Reset to default"
                >
                  ✕
                </button>
              )}
            </div>
          </div>,
          document.body,
        );
      })()}

      {/* Shell picker portal — above everything including the sidebar */}
      {shellPickerOpen && shellDropdownPos && createPortal(
        <div
          ref={shellPickerRef}
          className={styles.shellDropdown}
          style={{ top: shellDropdownPos.top, left: shellDropdownPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.shellDropdownHeader}>New tab with</div>
          {availableShells.map((shell) => {
            const isLastUsed = shell.path === selectedShell?.path && shell.name === selectedShell?.name;
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

      {/* Terminal Viewports */}
      <div className={styles.viewports}>
        {!isInitializing && sessions.length === 0 ? (
          <div className={styles.emptyState}>
            <Terminal className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No active terminal sessions</p>
            <p className={styles.emptyDesc}>Pick a shell and launch a session for this workspace.</p>
            <button onClick={() => createNewTab()} className={styles.launchBtn}>
              <Plus className={styles.smallIcon} />
              <span>Launch Terminal Session</span>
            </button>
          </div>
        ) : (
          sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const tabRef = tabRefs.current.get(session.id) ?? null;
            return (
              <div
                key={session.id}
                className={cx(
                  styles.viewportWrapper,
                  !isActive && styles.viewportWrapperHidden,
                )}
              >
                <TerminalTab
                  ref={tabRef}
                  sessionId={session.id}
                  workspacePath={workspacePath}
                  shell={session.shell}
                  shellArgs={session.shellArgs}
                />
              </div>
            );
          })
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
    &::-webkit-scrollbar { display: none; }
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
  tabDragging: css`
    opacity: 0.4;
    cursor: grabbing;
  `,
  tabDragOver: css`
    box-shadow: -3px 0 0 0 var(--color-brand);
  `,

  /* Color dot */
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
    transition: transform 150ms ease, box-shadow 150ms ease;
    &:hover {
      transform: scale(1.4);
      box-shadow: 0 0 0 2px rgba(255,255,255,0.15);
    }
  `,
  colorDotActive: css`
    box-shadow: 0 0 0 2px rgba(255,255,255,0.1);
  `,

  /* Color picker popover — rendered as a portal on document.body */
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
      from { opacity: 0; transform: scale(0.92) translateY(-4px); }
      to   { opacity: 1; transform: scale(1)    translateY(0); }
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
    transition: transform 120ms ease, border-color 120ms ease;
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

  /* New-tab button wrapper — sits flush after tabs */
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
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
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
    &:hover { background-color: var(--bg-hover); }
  `,
  shellDropdownItemActive: css`
    background-color: rgba(123, 104, 238, 0.10);
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
    transition: color 150ms ease, background-color 150ms ease;
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
    &:hover { color: var(--color-brand); }
  `,

  viewports: css`
    flex: 1;
    background-color: var(--bg-canvas);
    min-height: 0;
    position: relative;
  `,
  viewportWrapper: css`
    position: absolute;
    inset: 0;
  `,
  viewportWrapperHidden: css`
    visibility: hidden;
    pointer-events: none;
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
    width: 40px; height: 40px;
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
    box-shadow: 0 4px 14px rgba(123, 104, 238, 0.30);
    transition: box-shadow 0.2s, filter 0.2s;
    &:hover { box-shadow: 0 6px 20px rgba(123, 104, 238, 0.40); filter: brightness(1.06); }
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
