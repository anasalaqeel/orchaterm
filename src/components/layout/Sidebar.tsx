import { NavLink, useNavigate, useMatch } from 'react-router';
import { css, cx } from '@emotion/css';
import { useDashboard } from '../../context/DashboardContext';
import {
  History, Sparkles, Settings,
  Sun, Moon, Blocks, LayoutDashboard,
} from 'lucide-react';

// ── Route definitions ─────────────────────────────────────────────────────────
// Overview is handled separately because its active state depends on viewMode,
// not just the route (route '/' is shared by both grid and console views).

const NAV_ITEMS = [
  { to: '/logs',    label: 'Task Log',     icon: History },
  { to: '/prompts', label: 'Prompt Vault', icon: Sparkles },
  { to: '/settings',label: 'Settings',     icon: Settings },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const {
    theme, toggleTheme,
    workspaces, activeWorkspaceId, setActiveWorkspaceId,
    viewMode, setViewMode,
  } = useDashboard();

  const navigate    = useNavigate();
  const onDashboard = useMatch('/');

  // A workspace button is "active" when we're on '/' AND it's the active
  // workspace AND we're in console mode (viewing its terminal).
  const openWorkspace = (id: string) => {
    setActiveWorkspaceId(id);
    setViewMode('console');
    navigate('/');
  };

  // Overview is active only when we're on '/' in grid mode.
  // When in console mode the workspace button (above) is the active indicator,
  // not the Overview nav item.
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

        {/* Workspaces */}
        <span className={s.sectionLabel}>Workspaces</span>
        <div className={s.workspaceList}>
          {workspaces.length === 0 && (
            <p className={s.empty}>No workspaces yet.</p>
          )}
          {workspaces.map(w => {
            const isActive = !!onDashboard && viewMode === 'console' && w.id === activeWorkspaceId;
            return (
              <button
                key={w.id}
                onClick={() => openWorkspace(w.id)}
                className={cx(s.wsBtn, isActive && s.wsBtnActive)}
              >
                <span className={s.wsDot} style={{ backgroundColor: w.color }} />
                <span className={s.wsName}>{w.name}</span>
              </button>
            );
          })}
        </div>

        <div className={s.divider} />

        {/* Navigation */}
        <span className={s.sectionLabel}>Navigation</span>
        <nav className={s.nav}>

          {/* Overview — must be handled outside the generic map so we can
              apply viewMode-aware active state instead of route-only matching. */}
          <NavLink
            to="/"
            end
            className={cx(s.navBtn, isOverviewActive && s.navBtnActive)}
            onClick={() => setViewMode('grid')}
          >
            <LayoutDashboard className={s.navIcon} />
            <span>Overview</span>
          </NavLink>

          {/* Standard nav items — their routes are unique so isActive is reliable */}
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={navLinkClass}
            >
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
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background-color: #FF9D00;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #0d2131;
    flex-shrink: 0;
  `,
  logoIcon: css`
    width: 20px;
    height: 20px;
  `,
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
    gap: 4px;
  `,
  empty: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-style: italic;
    padding: 0 var(--spacing-sm);
  `,
  wsBtn: css`
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: 10px 12px;
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
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    animation: pulse 2s ease-in-out infinite;
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.5; }
    }
  `,
  wsName: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  divider: css`
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 12px 0;
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
  navIcon: css`
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  `,
  footer: css`
    padding: var(--spacing-md);
    border-top: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  version: css`
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  `,
  themeBtn: css`
    padding: 8px;
    border-radius: var(--border-radius-sm);
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s, color 0.15s;
    &:hover { background-color: var(--bg-hover); color: var(--text-primary); }
  `,
  themeIcon: css`
    width: 16px;
    height: 16px;
  `,
};
