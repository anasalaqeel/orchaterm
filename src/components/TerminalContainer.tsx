import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TerminalTab, TerminalTabHandle } from './TerminalTab';
import { useDashboard } from '../context/DashboardContext';
import { invoke } from '@tauri-apps/api/core';
import { Plus, X, Terminal, Edit2 } from 'lucide-react';
import { css, cx } from '@emotion/css';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TerminalSession {
  id: string;
  title: string;
}

interface TerminalContainerProps {
  workspaceId: string;
  workspacePath: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export const TerminalContainer: React.FC<TerminalContainerProps> = ({
  workspaceId,
  workspacePath,
}) => {
  const { settings } = useDashboard();

  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  // Monotonically increasing counter so tab names never collide after closes.
  const tabCounter = useRef(0);

  // Refs for each mounted TerminalTab so we can call fit() on tab switch.
  const tabRefs = useRef<Map<string, React.RefObject<TerminalTabHandle | null>>>(new Map());

  // ── Workspace change: kill old sessions, create a fresh default tab ──────
  const prevWorkspaceId = useRef(workspaceId);

  useEffect(() => {
    // Kill all PTY sessions from the previous workspace.
    if (prevWorkspaceId.current !== workspaceId) {
      sessions.forEach((s) => {
        invoke('kill_pty', { sessionId: s.id }).catch(() => {});
      });
      tabRefs.current.clear();
    }
    prevWorkspaceId.current = workspaceId;

    // Create a fresh default session for the new workspace.
    tabCounter.current = 1;
    const defaultId = crypto.randomUUID();
    tabRefs.current.set(defaultId, React.createRef<TerminalTabHandle | null>());
    setSessions([{ id: defaultId, title: 'Terminal 1' }]);
    setActiveSessionId(defaultId);
    setEditingSessionId(null);

    // Cleanup: when this component unmounts entirely, kill every session.
    return () => {
      setSessions((prev) => {
        prev.forEach((s) => {
          invoke('kill_pty', { sessionId: s.id }).catch(() => {});
        });
        return prev;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // ── Tab actions ──────────────────────────────────────────────────────────

  const createNewTab = useCallback(() => {
    tabCounter.current += 1;
    const newId = crypto.randomUUID();
    // Create the ref eagerly so it's available before the first render of the new tab.
    tabRefs.current.set(newId, React.createRef<TerminalTabHandle | null>());
    const newSession: TerminalSession = {
      id: newId,
      title: `Terminal ${tabCounter.current}`,
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newId);
  }, []);

  const closeTab = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();

      // Kill the PTY for the closed tab.
      invoke('kill_pty', { sessionId }).catch(() => {});
      tabRefs.current.delete(sessionId);

      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== sessionId);
        // If we closed the active tab, switch to the last remaining.
        if (activeSessionId === sessionId) {
          setActiveSessionId(
            next.length > 0 ? next[next.length - 1].id : null,
          );
        }
        return next;
      });
    },
    [activeSessionId],
  );

  const switchTab = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    // Re-fit the terminal after it becomes visible (next frame).
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
        prev.map((s) =>
          s.id === id ? { ...s, title: editingTitle.trim() } : s,
        ),
      );
    }
    setEditingSessionId(null);
  };

  const handleRenameKeyDown = (id: string, e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveRename(id);
    else if (e.key === 'Escape') setEditingSessionId(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.container}>
      {/* Tabs Header */}
      <div className={styles.header}>
        <div className={styles.tabsList}>
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isEditing = session.id === editingSessionId;

            return (
              <div
                key={session.id}
                onClick={() => switchTab(session.id)}
                className={cx(
                  styles.tab,
                  isActive ? styles.activeTab : styles.inactiveTab,
                )}
              >
                <Terminal
                  className={cx(
                    styles.tabIcon,
                    isActive ? styles.activeTabIcon : styles.inactiveTabIcon,
                  )}
                />

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
                    onDoubleClick={(e) =>
                      startRename(session.id, session.title, e)
                    }
                    className={styles.tabTitle}
                    title="Double click to rename"
                  >
                    {session.title}
                  </span>
                )}

                <div className={cx(styles.tabActions, 'tab-actions-btn-group')}>
                  {!isEditing && (
                    <button
                      onClick={(e) =>
                        startRename(session.id, session.title, e)
                      }
                      className={styles.tabActionBtn}
                      title="Rename Tab"
                    >
                      <Edit2 className={styles.tinyIcon} />
                    </button>
                  )}
                  <button
                    onClick={(e) => closeTab(session.id, e)}
                    className={styles.closeTabBtn}
                    title="Close Tab"
                  >
                    <X className={styles.tinyIcon} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* New Tab Button */}
        <button onClick={createNewTab} className={styles.newTabBtn}>
          <Plus className={styles.smallIcon} />
          <span>New Tab</span>
        </button>
      </div>

      {/* Terminal Viewports — only the ACTIVE tab is rendered */}
      <div className={styles.viewports}>
        {sessions.length === 0 ? (
          <div className={styles.emptyState}>
            <Terminal className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No active terminal sessions</p>
            <p className={styles.emptyDesc}>
              Launch a new session to run shell commands in the workspace
              context.
            </p>
            <button onClick={createNewTab} className={styles.launchBtn}>
              <Plus className={styles.smallIcon} />
              <span>Launch Terminal Session</span>
            </button>
          </div>
        ) : (
          sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            // Only render the active tab. Inactive tabs are not mounted,
            // meaning no PTY is spawned, no xterm canvas allocated, and no
            // ResizeObserver fires for zero-size containers.
            if (!isActive) return null;
            const tabRef = tabRefs.current.get(session.id) ?? null;
            return (
              <div key={session.id} className={styles.viewportWrapper}>
                <TerminalTab
                  ref={tabRef}
                  sessionId={session.id}
                  workspacePath={workspacePath}
                  shell={settings.shellPath}
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
    background-color: #0d2131;
    border: 1px solid rgba(30, 41, 59, 0.8);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    background-color: #0b1b28;
    padding: 0 16px;
    border-bottom: 1px solid #09131a;
    user-select: none;
  `,
  tabsList: css`
    display: flex;
    align-items: flex-end;
    overflow-x: auto;
    padding-top: 8px;
    gap: 4px;
    &::-webkit-scrollbar {
      display: none;
    }
    scrollbar-width: none;
  `,
  tab: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    font-size: 12px;
    font-weight: 700;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    border-top: 2px solid transparent;
    cursor: pointer;
    transition: all 150ms ease;
    user-select: none;

    &:hover .tab-actions-btn-group {
      opacity: 1;
    }
  `,
  activeTab: css`
    background-color: #0d2131;
    border-top-color: #ff9d00;
    color: #f1f5f9;
  `,
  inactiveTab: css`
    background-color: #0b1b28;
    color: #94a3b8;
    &:hover {
      background-color: #0f2334;
      color: #e2e8f0;
    }
  `,
  tabIcon: css`
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    transition: color 150ms ease;
  `,
  activeTabIcon: css`
    color: #ff9d00;
  `,
  inactiveTabIcon: css`
    color: #64748b;
  `,
  renameInput: css`
    background-color: #0f172a;
    border: 1px solid #334155;
    color: #f1f5f9;
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
    max-width: 100px;
  `,
  tabActions: css`
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0;
    margin-left: 4px;
    transition: opacity 150ms ease;
  `,
  tabActionBtn: css`
    padding: 2px;
    border-radius: 4px;
    color: #94a3b8;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 150ms ease;
    display: flex;
    align-items: center;
    justify-content: center;
    &:hover {
      background-color: #1e293b;
      color: #cbd5e1;
    }
  `,
  closeTabBtn: css`
    padding: 2px;
    border-radius: 4px;
    color: #94a3b8;
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
  newTabBtn: css`
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    background-color: #193549;
    border: 1px solid #1f3a4e;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    transition: all 150ms ease;
    &:hover {
      color: #ffffff;
      background-color: #1f425b;
    }
  `,
  viewports: css`
    flex: 1;
    background-color: #0d2131;
    min-height: 0;
    position: relative;
  `,
  viewportWrapper: css`
    width: 100%;
    height: 100%;
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
    color: #64748b;
  `,
  emptyIcon: css`
    width: 32px;
    height: 32px;
    color: #334155;
    margin-bottom: 12px;
  `,
  emptyTitle: css`
    font-weight: 700;
    color: #94a3b8;
    font-size: 14px;
    margin: 0;
  `,
  emptyDesc: css`
    font-size: 12px;
    color: #64748b;
    margin-top: 4px;
    margin-bottom: 16px;
  `,
  launchBtn: css`
    display: flex;
    align-items: center;
    gap: 6px;
    background-color: #2563eb;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: background-color 150ms ease;
    &:hover {
      background-color: #3b82f6;
    }
  `,
  tinyIcon: css`
    width: 10px;
    height: 10px;
  `,
  smallIcon: css`
    width: 14px;
    height: 14px;
  `,
};
