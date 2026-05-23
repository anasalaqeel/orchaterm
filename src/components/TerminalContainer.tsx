import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TerminalTab, TerminalTabHandle } from './TerminalTab';
import { useDashboard } from '../context/DashboardContext';
import { invoke } from '@tauri-apps/api/core';
import { Plus, X, Terminal, Edit2, ChevronDown, Check } from 'lucide-react';
import { css, cx } from '@emotion/css';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ShellInfo {
  name: string;
  path: string;
  args: string[];
}

interface TerminalSession {
  id: string;
  title: string;
  /** Shell executable for this tab. */
  shell: string;
  /** Extra args forwarded to spawn_pty (e.g. ["--", "bash"] for WSL bash). */
  shellArgs: string[];
}

interface TerminalContainerProps {
  workspaceId: string;
  workspacePath: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns just the basename without extension for display in tab titles. */
function shellBasename(path: string): string {
  const part = path.replace(/\\/g, '/').split('/').pop() ?? path;
  return part.replace(/\.(exe|cmd|bat|sh)$/i, '');
}

// ── Component ──────────────────────────────────────────────────────────────────

export const TerminalContainer: React.FC<TerminalContainerProps> = ({
  workspaceId,
  workspacePath,
}) => {
  const { settings } = useDashboard();

  // ── Shell detection ──────────────────────────────────────────────────────
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);
  const [selectedShell, setSelectedShell] = useState<ShellInfo | null>(null);
  const [shellPickerOpen, setShellPickerOpen] = useState(false);
  const shellPickerRef = useRef<HTMLDivElement>(null);

  // Keep a ref so workspace-change effect always reads the latest value without
  // needing to be listed as a dependency.
  const selectedShellRef = useRef<ShellInfo | null>(null);
  selectedShellRef.current = selectedShell;

  useEffect(() => {
    invoke<ShellInfo[]>('get_available_shells')
      .then((shells) => {
        if (shells.length === 0) return;
        setAvailableShells(shells);

        // Prefer the shell the user configured in Settings, otherwise pick the
        // first one the OS reports.
        const preferred = shells.find(
          (s) =>
            s.path === settings.shellPath ||
            s.name.toLowerCase().includes(shellBasename(settings.shellPath).toLowerCase()),
        );
        setSelectedShell(preferred ?? shells[0]);
      })
      .catch(() => {
        // Fallback: at least offer the configured shell path.
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

  // Close shell picker on outside click.
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
    if (prevWorkspaceId.current !== workspaceId) {
      sessions.forEach((s) => {
        invoke('kill_pty', { sessionId: s.id }).catch(() => {});
      });
      tabRefs.current.clear();
    }
    prevWorkspaceId.current = workspaceId;

    const shell = selectedShellRef.current;
    const shellPath = shell?.path ?? settings.shellPath ?? 'powershell';
    const shellArgs = shell?.args ?? [];
    const shellName = shell?.name ?? shellBasename(shellPath);

    tabCounter.current = 1;
    const defaultId = crypto.randomUUID();
    tabRefs.current.set(defaultId, React.createRef<TerminalTabHandle | null>());
    setSessions([{ id: defaultId, title: `${shellName} 1`, shell: shellPath, shellArgs }]);
    setActiveSessionId(defaultId);
    setEditingSessionId(null);

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
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newId);
  }, [settings.shellPath]);

  const closeTab = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      invoke('kill_pty', { sessionId }).catch(() => {});
      tabRefs.current.delete(sessionId);

      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== sessionId);
        if (activeSessionId === sessionId) {
          setActiveSessionId(next.length > 0 ? next[next.length - 1].id : null);
        }
        return next;
      });
    },
    [activeSessionId],
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
                className={cx(styles.tab, isActive ? styles.activeTab : styles.inactiveTab)}
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
                    onDoubleClick={(e) => startRename(session.id, session.title, e)}
                    className={styles.tabTitle}
                    title={`${session.title} — double-click to rename`}
                  >
                    {session.title}
                  </span>
                )}

                <div className={cx(styles.tabActions, 'tab-actions-btn-group')}>
                  {!isEditing && (
                    <button
                      onClick={(e) => startRename(session.id, session.title, e)}
                      className={styles.tabActionBtn}
                      title="Rename tab"
                    >
                      <Edit2 className={styles.tinyIcon} />
                    </button>
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

        {/* Right-side controls: shell picker + new-tab button */}
        <div className={styles.headerRight}>
          {/* Shell picker */}
          {availableShells.length > 0 && (
            <div ref={shellPickerRef} className={styles.shellPickerWrapper}>
              <button
                className={styles.shellPickerBtn}
                onClick={() => setShellPickerOpen((o) => !o)}
                title="Select shell for new tabs"
              >
                <Terminal className={styles.shellPickerIcon} />
                <span className={styles.shellPickerLabel}>
                  {selectedShell?.name ?? '…'}
                </span>
                <ChevronDown
                  className={cx(
                    styles.shellPickerChevron,
                    shellPickerOpen && styles.shellPickerChevronOpen,
                  )}
                />
              </button>

              {shellPickerOpen && (
                <div className={styles.shellDropdown}>
                  <div className={styles.shellDropdownHeader}>Open new tab with</div>
                  {availableShells.map((shell) => {
                    const isActive = shell.path === selectedShell?.path;
                    return (
                      <button
                        key={shell.path}
                        className={cx(
                          styles.shellDropdownItem,
                          isActive && styles.shellDropdownItemActive,
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
                        {isActive && <Check className={styles.shellItemCheck} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* New Tab button — uses currently selected shell */}
          <button onClick={() => createNewTab()} className={styles.newTabBtn}>
            <Plus className={styles.smallIcon} />
            <span>New Tab</span>
          </button>
        </div>
      </div>

      {/* Terminal Viewports */}
      <div className={styles.viewports}>
        {sessions.length === 0 ? (
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
          sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            if (!isActive) return null;
            const tabRef = tabRefs.current.get(session.id) ?? null;
            return (
              <div key={session.id} className={styles.viewportWrapper}>
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
    background-color: #070d14;
    overflow: hidden;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    background-color: #0b1520;
    padding: 0 12px 0 0;
    border-bottom: 1px solid #0d1c2a;
    user-select: none;
    flex-shrink: 0;
    gap: 8px;
  `,
  tabsList: css`
    display: flex;
    align-items: flex-end;
    overflow-x: auto;
    padding-top: 8px;
    flex: 1;
    gap: 4px;
    min-width: 0;
    &::-webkit-scrollbar { display: none; }
    scrollbar-width: none;
  `,
  tab: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 700;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    border-top: 2px solid transparent;
    cursor: pointer;
    transition: all 150ms ease;
    user-select: none;
    flex-shrink: 0;

    &:hover .tab-actions-btn-group {
      opacity: 1;
    }
  `,
  activeTab: css`
    background-color: #070d14;
    border-top-color: #ff9d00;
    color: #f1f5f9;
  `,
  inactiveTab: css`
    background-color: #0b1520;
    color: #64748b;
    &:hover {
      background-color: #0d1c2a;
      color: #94a3b8;
    }
  `,
  tabIcon: css`
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    transition: color 150ms ease;
  `,
  activeTabIcon: css`
    color: #ff9d00;
  `,
  inactiveTabIcon: css`
    color: #475569;
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

  /* ── Right-side header controls ── */
  headerRight: css`
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    padding: 6px 0;
  `,

  /* Shell picker button */
  shellPickerWrapper: css`
    position: relative;
  `,
  shellPickerBtn: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
    background-color: #0d1c2a;
    border: 1px solid #1a2e40;
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
    transition: all 150ms ease;
    white-space: nowrap;
    &:hover {
      color: #e2e8f0;
      background-color: #122030;
      border-color: #243a50;
    }
  `,
  shellPickerIcon: css`
    width: 12px;
    height: 12px;
    color: #ff9d00;
    flex-shrink: 0;
  `,
  shellPickerLabel: css`
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  shellPickerChevron: css`
    width: 12px;
    height: 12px;
    transition: transform 150ms ease;
    flex-shrink: 0;
  `,
  shellPickerChevronOpen: css`
    transform: rotate(180deg);
  `,

  /* Shell dropdown */
  shellDropdown: css`
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 200;
    min-width: 240px;
    background-color: #0b1520;
    border: 1px solid #1a2e40;
    border-radius: 8px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
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
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #475569;
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
      background-color: #122030;
    }
  `,
  shellDropdownItemActive: css`
    background-color: rgba(255, 157, 0, 0.08);
  `,
  shellItemIcon: css`
    width: 13px;
    height: 13px;
    color: #ff9d00;
    flex-shrink: 0;
  `,
  shellItemName: css`
    font-size: 12px;
    font-weight: 600;
    color: #e2e8f0;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  shellItemPath: css`
    font-size: 10px;
    color: #475569;
    font-family: 'Fira Code', monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80px;
  `,
  shellItemCheck: css`
    width: 12px;
    height: 12px;
    color: #ff9d00;
    flex-shrink: 0;
  `,

  /* New tab button */
  newTabBtn: css`
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    background-color: #0d1c2a;
    border: 1px solid #1a2e40;
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
    transition: all 150ms ease;
    white-space: nowrap;
    &:hover {
      color: #ffffff;
      background-color: #122030;
      border-color: #243a50;
    }
  `,

  /* Viewports */
  viewports: css`
    flex: 1;
    background-color: #070d14;
    min-height: 0;
    position: relative;
  `,
  viewportWrapper: css`
    width: 100%;
    height: 100%;
  `,

  /* Empty state */
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
    color: #1e3a5f;
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
    background-color: #ff9d00;
    color: #070d14;
    font-size: 12px;
    font-weight: 700;
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: background-color 150ms ease;
    &:hover {
      background-color: #ffb733;
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
