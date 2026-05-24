import { useState } from 'react';
import { NavLink, useNavigate, useMatch } from 'react-router';
import { css, cx } from '@emotion/css';
import { useDashboard } from '../../context/DashboardContext';
import { Space } from '../../types';
import { SpaceManagerModal } from '../ui/SpaceManagerModal';
import {
  History, Sparkles, Settings,
  Sun, Moon, Blocks, LayoutDashboard,
  Plus, Edit2, Trash2,
} from 'lucide-react';

// ── Route definitions ─────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: '/logs',     label: 'Task Log',     icon: History },
  { to: '/prompts',  label: 'Prompt Vault', icon: Sparkles },
  { to: '/settings', label: 'Settings',     icon: Settings },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const {
    theme, toggleTheme,
    workspaces, activeWorkspaceId, setActiveWorkspaceId,
    viewMode, setViewMode,
    spaces, deleteSpace,
    activeSpaceId, setActiveSpaceId,
  } = useDashboard();

  const navigate    = useNavigate();
  const onDashboard = useMatch('/');

  // ── Space modal state ─────────────────────────────────────────────────────
  const [spaceModalOpen, setSpaceModalOpen] = useState(false);
  const [editingSpace,   setEditingSpace]   = useState<Space | undefined>(undefined);
  const [modalWorkspaceId, setModalWorkspaceId] = useState<string>('');

  const openCreateSpace = (workspaceId: string) => {
    setModalWorkspaceId(workspaceId);
    setEditingSpace(undefined);
    setSpaceModalOpen(true);
  };

  const openEditSpace = (sp: Space) => {
    setModalWorkspaceId(sp.workspaceId);
    setEditingSpace(sp);
    setSpaceModalOpen(true);
  };

  const handleDeleteSpace = (sp: Space) => {
    if (window.confirm(`Delete space "${sp.name}"?`)) deleteSpace(sp.id);
  };

  // ── Workspace nav ─────────────────────────────────────────────────────────
  const openWorkspace = (id: string) => {
    setActiveWorkspaceId(id);
    setViewMode('console');
    navigate('/');
  };

  const isOverviewActive = !!onDashboard && viewMode === 'grid';
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cx(s.navBtn, isActive && s.navBtnActive);

  return (
    <aside className={s.sidebar}>

      {/* Brand */}
      <div className={s.brand}>
        <div className={s.logo}><Blocks className={s.logoIcon} /></div>
        <div>
          <h1 className={s.title}>AgentDeck</h1>
          <span className={s.subtitle}>Developer Hub</span>
        </div>
      </div>

      <div className={s.body}>

        {/* ── Workspaces (with nested spaces) ── */}
        <span className={s.sectionLabel}>Workspaces</span>
        <div className={s.workspaceList}>
          {workspaces.length === 0 && (
            <p className={s.empty}>No workspaces yet.</p>
          )}
          {workspaces.map(w => {
            const isConsoleActive = !!onDashboard && viewMode === 'console' && w.id === activeWorkspaceId;
            const workspaceSpaces = spaces.filter(sp => sp.workspaceId === w.id);

            return (
              <div key={w.id}>
                {/* Workspace row */}
                <button
                  onClick={() => openWorkspace(w.id)}
                  className={cx(s.wsBtn, isConsoleActive && s.wsBtnActive)}
                >
                  <span className={s.wsDot} style={{ backgroundColor: w.color }} />
                  <span className={s.wsName}>{w.name}</span>
                </button>

                {/* Spaces — shown only when this workspace is active in console mode */}
                {isConsoleActive && (
                  <div className={s.spaceList}>
                    {workspaceSpaces.map(sp => {
                      const isSpaceActive = sp.id === activeSpaceId;
                      return (
                        <div
                          key={sp.id}
                          className={cx(s.spaceRow, isSpaceActive && s.spaceRowActive)}
                          style={isSpaceActive ? { borderLeftColor: sp.color } : undefined}
                          onClick={() => setActiveSpaceId(isSpaceActive ? null : sp.id)}
                        >
                          <span className={s.spaceConnector} />
                          <span className={s.spaceDot} style={{ backgroundColor: sp.color }} />
                          <span className={s.spaceName}>{sp.name}</span>
                          <div className={s.spaceActions}>
                            <button
                              className={s.spaceActionBtn}
                              onClick={e => { e.stopPropagation(); openEditSpace(sp); }}
                              title="Edit space"
                            >
                              <Edit2 size={9} />
                            </button>
                            <button
                              className={cx(s.spaceActionBtn, s.spaceDeleteBtn)}
                              onClick={e => { e.stopPropagation(); handleDeleteSpace(sp); }}
                              title="Delete space"
                            >
                              <Trash2 size={9} />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* New space button */}
                    <button
                      className={s.newSpaceBtn}
                      onClick={() => openCreateSpace(w.id)}
                    >
                      <span className={s.spaceConnector} />
                      <Plus size={9} className={s.newSpaceIcon} />
                      <span>New Space</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className={s.divider} />

        {/* ── Navigation ── */}
        <span className={s.sectionLabel}>Navigation</span>
        <nav className={s.nav}>

          <NavLink
            to="/"
            end
            className={cx(s.navBtn, isOverviewActive && s.navBtnActive)}
            onClick={() => setViewMode('grid')}
          >
            <LayoutDashboard className={s.navIcon} />
            <span>Overview</span>
          </NavLink>

          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClass}>
              <Icon className={s.navIcon} />
              <span>{label}</span>
            </NavLink>
          ))}

        </nav>

      </div>

      {/* Footer */}
      <div className={s.footer}>
        <span className={s.version}>v0.1.0 (Beta)</span>
        <button
          onClick={toggleTheme}
          className={s.themeBtn}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? <Sun className={s.themeIcon} /> : <Moon className={s.themeIcon} />}
        </button>
      </div>

      {/* Space create/edit modal */}
      {spaceModalOpen && modalWorkspaceId && (
        <SpaceManagerModal
          workspaceId={modalWorkspaceId}
          space={editingSpace}
          onClose={() => setSpaceModalOpen(false)}
        />
      )}

    </aside>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  sidebar: css`
    width: 256px;
    border-right: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    height: 100vh;
    flex-shrink: 0;
    transition: background-color 0.3s ease, border-color 0.3s ease;
  `,
  brand: css`
    padding: var(--spacing-lg);
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    gap: 12px;
    user-select: none;
  `,
  logo: css`
    width: 32px; height: 32px; border-radius: 8px;
    background-color: #FF9D00;
    display: flex; align-items: center; justify-content: center;
    color: #0d2131; flex-shrink: 0;
  `,
  logoIcon: css`width: 20px; height: 20px;`,
  title: css`
    font-weight: var(--font-weight-bold);
    font-size: var(--font-size-xl);
    line-height: 1;
    letter-spacing: -0.025em;
    color: var(--text-primary);
  `,
  subtitle: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  `,
  body: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--spacing-lg) var(--spacing-md) 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
  `,
  sectionLabel: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 var(--spacing-sm);
    user-select: none;
  `,
  workspaceList: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  empty: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-style: italic;
    padding: 0 var(--spacing-sm);
  `,

  /* Workspace row */
  wsBtn: css`
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: 9px 12px;
    border-radius: var(--border-radius-sm);
    border: none;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    transition: all 0.15s ease;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    &:hover { color: var(--text-primary); background-color: var(--bg-hover); }
  `,
  wsBtnActive: css`
    background-color: var(--bg-hover);
    border-left-color: var(--color-primary);
    color: var(--color-primary);
    &:hover { color: var(--color-primary); }
  `,
  wsDot: css`
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    animation: pulse 2s ease-in-out infinite;
    @keyframes pulse {
      0%, 100% { opacity: 1 }
      50%       { opacity: 0.5 }
    }
  `,
  wsName: css`
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
  `,

  /* Space list (nested under active workspace) */
  spaceList: css`
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 2px;
    padding-bottom: 4px;
  `,

  /* Connector line visual */
  spaceConnector: css`
    width: 16px;
    flex-shrink: 0;
    position: relative;
    &::before {
      content: '';
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 6px;
      height: 1px;
      background: var(--border-color);
    }
  `,

  /* Space row */
  spaceRow: css`
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px 6px 4px;
    border-radius: var(--border-radius-sm);
    border: none;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s ease;
    position: relative;
    user-select: none;

    &:hover {
      color: var(--text-secondary);
      background: var(--bg-hover);
    }
    &:hover .space-actions { opacity: 1; }
  `,
  spaceRowActive: css`
    color: var(--text-primary) !important;
    background: var(--bg-hover) !important;
  `,
  spaceDot: css`
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  `,
  spaceName: css`
    flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  spaceActions: css`
    display: flex;
    align-items: center;
    gap: 1px;
    opacity: 0;
    transition: opacity 120ms ease;
    flex-shrink: 0;
  `,
  spaceActionBtn: css`
    width: 16px; height: 16px; border-radius: 3px; border: none;
    background: transparent; color: var(--text-tertiary);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all 100ms ease;
    &:hover { background: var(--bg-hover); color: var(--text-primary); }
  `,
  spaceDeleteBtn: css`
    &:hover {
      background: rgba(239,68,68,0.12) !important;
      color: #ef4444 !important;
    }
  `,

  /* New space button */
  newSpaceBtn: css`
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 8px 5px 4px;
    border-radius: var(--border-radius-sm);
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s ease;
    width: 100%;
    text-align: left;
    letter-spacing: 0.01em;
    &:hover { color: #FF9D00; background: var(--bg-hover); }
  `,
  newSpaceIcon: css`
    color: inherit; flex-shrink: 0;
  `,

  divider: css`
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 8px 0;
  `,
  nav: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-bottom: var(--spacing-lg);
  `,
  navBtn: css`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: var(--border-radius-sm);
    border-left: 2px solid transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    text-decoration: none;
    transition: all 0.15s ease;
    &:hover { color: var(--text-primary); background-color: var(--bg-hover); }
  `,
  navBtnActive: css`
    background-color: var(--bg-hover);
    border-left-color: var(--color-primary);
    color: var(--color-primary);
    &:hover { color: var(--color-primary); }
  `,
  navIcon: css`width: 16px; height: 16px; flex-shrink: 0;`,
  footer: css`
    padding: var(--spacing-md);
    border-top: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  version: css`font-size: var(--font-size-xs); color: var(--text-tertiary);`,
  themeBtn: css`
    padding: 8px;
    border-radius: var(--border-radius-sm);
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background-color 0.15s, color 0.15s;
    &:hover { background-color: var(--bg-hover); color: var(--text-primary); }
  `,
  themeIcon: css`width: 16px; height: 16px;`,
};
