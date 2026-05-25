import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useMatch } from 'react-router';
import { css, cx } from '@emotion/css';
import { useDashboard } from '../../context/DashboardContext';
import { Space } from '../../types';
import { SpaceManagerModal } from '../ui/SpaceManagerModal';
import {
  History, Sparkles, Settings,
  Sun, Moon, Blocks, LayoutDashboard,
  Plus, Edit2, Trash2, Terminal,
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
    deleteWorkspace,
    viewMode, setViewMode,
    spaces, deleteSpace,
    activeSpaceId, setActiveSpaceId,
  } = useDashboard();

  const navigate    = useNavigate();
  const onDashboard = useMatch('/');

  // ── Sidebar selection (independent of console) ───────────────────────────
  // Clicking a workspace only expands it in the sidebar — does NOT navigate.
  // The console tracks its own workspace via activeWorkspaceId.
  const [sidebarFocusedId, setSidebarFocusedId] = useState<string | null>(activeWorkspaceId);

  // Keep sidebar in sync when the console workspace changes externally
  // (e.g. user opens a workspace from the Overview grid).
  useEffect(() => {
    if (activeWorkspaceId) setSidebarFocusedId(activeWorkspaceId);
  }, [activeWorkspaceId]);

  // ── Hover tracking for action buttons ────────────────────────────────────
  const [hoveredWsId,    setHoveredWsId]    = useState<string | null>(null);
  const [hoveredSpaceId, setHoveredSpaceId] = useState<string | null>(null);

  // ── Space modal state ─────────────────────────────────────────────────────
  const [spaceModalOpen,   setSpaceModalOpen]   = useState(false);
  const [editingSpace,     setEditingSpace]     = useState<Space | undefined>(undefined);
  const [modalWorkspaceId, setModalWorkspaceId] = useState<string>('');

  // Listen for open-space-modal event dispatched by GroupChat stale banner
  useEffect(() => {
    const handler = () => {
      const spaceId = localStorage.getItem('agentdeck:open-space-modal');
      if (spaceId) {
        localStorage.removeItem('agentdeck:open-space-modal');
        const sp = spaces.find(s => s.id === spaceId);
        if (sp) openEditSpace(sp);
      }
    };
    window.addEventListener('agentdeck:open-space-modal', handler);
    return () => window.removeEventListener('agentdeck:open-space-modal', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces]);

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

  // ── Open workspace in console (explicit action only) ──────────────────────
  const openInConsole = (id: string) => {
    setActiveWorkspaceId(id);
    setSidebarFocusedId(id);
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

        {/* ── Workspaces ── */}
        <div className={s.sectionRow}>
          <span className={s.sectionLabel}>Workspaces</span>
          <button
            className={s.sectionAddBtn}
            title="New Workspace"
            onClick={() => {
              navigate('/');
              setViewMode('grid');
              localStorage.setItem('agentdeck:open-new-workspace', '1');
            }}
          >
            <Plus size={10} />
          </button>
        </div>
        <div className={s.workspaceList}>
          {workspaces.length === 0 && (
            <p className={s.empty}>No workspaces yet.</p>
          )}

          {workspaces.map(w => {
            const isFocused       = w.id === sidebarFocusedId;
            const isConsoleOpen   = !!onDashboard && viewMode === 'console' && w.id === activeWorkspaceId;
            const workspaceSpaces = spaces.filter(sp => sp.workspaceId === w.id);
            const isWsHovered     = hoveredWsId === w.id;

            return (
              <div key={w.id}>

                {/* Workspace row */}
                <div
                  className={cx(
                    s.wsRow,
                    isFocused   && s.wsRowFocused,
                    isConsoleOpen && s.wsRowConsoleOpen,
                  )}
                  style={isConsoleOpen ? { borderLeftColor: w.color } : undefined}
                  onMouseEnter={() => setHoveredWsId(w.id)}
                  onMouseLeave={() => setHoveredWsId(null)}
                >
                  {/* Click area — select only, no navigation */}
                  <button
                    className={s.wsClickArea}
                    onClick={() => setSidebarFocusedId(isFocused ? null : w.id)}
                  >
                    <span className={s.wsDot} style={{ backgroundColor: w.color }} />
                    <span className={s.wsName}>{w.name}</span>
                    {(() => {
                      const count = spaces.filter(sp => sp.workspaceId === w.id).length;
                      return count > 0 ? (
                        <span className={s.wsSpaceBadge}>{count}</span>
                      ) : null;
                    })()}
                  </button>

                  {/* Action buttons — visible on hover */}
                  <div className={cx(s.wsActions, !isWsHovered && s.hidden)}>
                    {/* Open in console */}
                    <button
                      className={cx(s.iconBtn, isConsoleOpen && s.iconBtnActive)}
                      title={isConsoleOpen ? 'Already open in console' : 'Open in console'}
                      onClick={() => openInConsole(w.id)}
                    >
                      <Terminal size={10} />
                    </button>
                    {/* Delete */}
                    <button
                      className={cx(s.iconBtn, s.iconBtnDanger)}
                      title="Delete workspace"
                      onClick={() => {
                        if (window.confirm(`Delete workspace "${w.name}" and all its spaces?`)) {
                          deleteWorkspace(w.id);
                        }
                      }}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>

                {/* Spaces — shown when workspace is focused in sidebar */}
                {isFocused && (
                  <div className={s.spaceList}>
                    {workspaceSpaces.map(sp => {
                      const isSpaceActive  = sp.id === activeSpaceId;
                      const isSpaceHovered = hoveredSpaceId === sp.id;

                      return (
                        <div
                          key={sp.id}
                          className={cx(s.spaceRow, isSpaceActive && s.spaceRowActive)}
                          style={isSpaceActive
                            ? { borderLeftColor: sp.color, backgroundColor: sp.color + '18' }
                            : undefined}
                          onClick={() => setActiveSpaceId(isSpaceActive ? null : sp.id)}
                          onMouseEnter={() => setHoveredSpaceId(sp.id)}
                          onMouseLeave={() => setHoveredSpaceId(null)}
                        >
                          <span className={s.spaceConnector} />
                          <span
                            className={s.spaceDot}
                            style={{
                              backgroundColor: sp.color,
                              boxShadow: isSpaceActive ? `0 0 0 2px ${sp.color}44` : undefined,
                            }}
                          />
                          <span className={s.spaceName}>{sp.name}</span>
                          {localStorage.getItem(`agentdeck:conductor:running:${w.id}`) === 'true' && (
                            <span className={s.spaceRunningDot} />
                          )}

                          {/* Space actions — shown on hover */}
                          <div className={cx(s.spaceActions, !isSpaceHovered && s.hidden)}>
                            <button
                              className={s.iconBtn}
                              title="Edit space"
                              onClick={e => { e.stopPropagation(); openEditSpace(sp); }}
                            >
                              <Edit2 size={9} />
                            </button>
                            <button
                              className={cx(s.iconBtn, s.iconBtnDanger)}
                              title="Delete space"
                              onClick={e => {
                                e.stopPropagation();
                                if (window.confirm(`Delete space "${sp.name}"?`)) deleteSpace(sp.id);
                              }}
                            >
                              <Trash2 size={9} />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* New space button */}
                    <button className={s.newSpaceBtn} onClick={() => openCreateSpace(w.id)}>
                      <span className={s.spaceConnector} />
                      <Plus size={9} />
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

      {/* Space modal */}
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
  sectionRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--spacing-sm);
    /* Override child sectionLabel padding so it doesn't double-apply */
    & > span { padding: 0; }
  `,
  sectionAddBtn: css`
    width: 18px; height: 18px; border-radius: 4px; border: none;
    background: transparent; color: var(--text-tertiary); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 120ms ease;
    &:hover { background: var(--bg-hover); color: #ff9d00; }
  `,
  wsSpaceBadge: css`
    font-size: 9px; font-weight: 700; color: var(--text-tertiary);
    background: var(--bg-tertiary); border-radius: 99px;
    padding: 1px 5px; flex-shrink: 0; letter-spacing: 0;
  `,
  spaceRunningDot: css`
    width: 5px; height: 5px; border-radius: 50%;
    background: #ff9d00; flex-shrink: 0;
    animation: runPulse 1.5s ease-in-out infinite;
    @keyframes runPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
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

  /* Workspace row wrapper */
  wsRow: css`
    width: 100%;
    display: flex;
    align-items: center;
    border-radius: var(--border-radius-sm);
    border-left: 2px solid transparent;
    transition: background 0.15s ease, border-color 0.15s ease;
    padding-right: 4px;
    &:hover { background-color: var(--bg-hover); }
  `,
  /* Sidebar-selected: subtle highlight, no border */
  wsRowFocused: css`
    background-color: var(--bg-hover);
  `,
  /* Console-open: colored left border marks the "live" workspace */
  wsRowConsoleOpen: css`
    background-color: var(--bg-hover);
  `,

  /* Action button group */
  wsActions: css`
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
    transition: opacity 120ms ease;
  `,

  /* Inner button: dot + name — click only selects, does NOT navigate */
  wsClickArea: css`
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: 8px 4px 8px 12px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    text-align: left;
    border-radius: var(--border-radius-sm);
    transition: color 0.15s ease;
    &:hover { color: var(--text-primary); }
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
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  `,

  /* Shared small icon button */
  iconBtn: css`
    flex-shrink: 0;
    width: 20px; height: 20px;
    border-radius: 4px; border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 100ms ease, color 100ms ease;
    padding: 0;
    &:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); }
  `,
  iconBtnDanger: css`
    &:hover { background: rgba(239,68,68,0.15) !important; color: #ef4444 !important; }
  `,
  iconBtnActive: css`
    color: var(--color-primary) !important;
  `,

  /* Utility: visually hidden but still in layout */
  hidden: css`
    opacity: 0;
    pointer-events: none;
  `,

  /* Space list */
  spaceList: css`
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 2px;
    padding-bottom: 4px;
  `,
  spaceConnector: css`
    width: 16px;
    flex-shrink: 0;
    position: relative;
    &::before {
      content: '';
      position: absolute;
      left: 10px; top: 50%;
      transform: translateY(-50%);
      width: 6px; height: 1px;
      background: var(--border-color);
    }
  `,
  spaceRow: css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px 5px 4px;
    border-radius: var(--border-radius-sm);
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s ease;
    user-select: none;
    &:hover { color: var(--text-secondary); background: var(--bg-hover); }
  `,
  spaceRowActive: css`
    color: var(--text-primary) !important;
  `,
  spaceDot: css`
    width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
    transition: box-shadow 150ms ease;
  `,
  spaceName: css`
    flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
  `,
  spaceActions: css`
    display: flex; align-items: center; gap: 1px; flex-shrink: 0;
    transition: opacity 120ms ease;
  `,

  /* New space button */
  newSpaceBtn: css`
    display: flex; align-items: center; gap: 6px;
    padding: 5px 6px 5px 4px;
    border-radius: var(--border-radius-sm);
    border: none; background: transparent;
    color: var(--text-tertiary);
    font-size: 10px; font-weight: 600;
    cursor: pointer; width: 100%; text-align: left;
    transition: all 0.12s ease;
    &:hover { color: #FF9D00; background: var(--bg-hover); }
  `,

  divider: css`
    border: none; border-top: 1px solid var(--border-color); margin: 8px 0;
  `,
  nav: css`
    display: flex; flex-direction: column; gap: 4px;
    padding-bottom: var(--spacing-lg);
  `,
  navBtn: css`
    display: flex; align-items: center; gap: 12px;
    padding: 8px 12px;
    border-radius: var(--border-radius-sm);
    border-left: 2px solid transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold);
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
    display: flex; align-items: center; justify-content: space-between;
  `,
  version: css`font-size: var(--font-size-xs); color: var(--text-tertiary);`,
  themeBtn: css`
    padding: 8px; border-radius: var(--border-radius-sm);
    border: 1px solid var(--border-color);
    background: transparent; color: var(--text-secondary);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background-color 0.15s, color 0.15s;
    &:hover { background-color: var(--bg-hover); color: var(--text-primary); }
  `,
  themeIcon: css`width: 16px; height: 16px;`,
};
