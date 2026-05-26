import { useState, type CSSProperties } from 'react';
import { NavLink, useNavigate, useMatch } from 'react-router';
import { css, cx } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import { useDashboard } from '../../context/DashboardContext';
import {
  History, Sparkles, Settings,
  Sun, Moon, Blocks, LayoutDashboard,
  Plus, Trash2,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/logs',     label: 'Task Log',     icon: History },
  { to: '/prompts',  label: 'Prompt Vault', icon: Sparkles },
  { to: '/settings', label: 'Settings',     icon: Settings },
] as const;

export function Sidebar() {
  const {
    theme, toggleTheme,
    workspaces, activeWorkspaceId, setActiveWorkspaceId,
    deleteWorkspace,
    viewMode, setViewMode,
  } = useDashboard();

  const navigate    = useNavigate();
  const onDashboard = useMatch('/');

  const [hoveredWsId, setHoveredWsId] = useState<string | null>(null);

  const openInConsole = (id: string) => {
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
        <div className={s.logo}>
          <Blocks className={s.logoIcon} />
        </div>
        <h1 className={s.title}>Orchaterm</h1>
        <span className={s.version}>β</span>
      </div>

      <div className={s.body}>

        {/* ── Workspaces ── */}
        <div className={s.sectionHead}>
          <span className={s.sectionLabel}>Workspaces</span>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.92 }}
            className={s.addBtn}
            title="New Workspace"
            onClick={() => {
              navigate('/');
              setViewMode('grid');
              localStorage.setItem('orchaterm:open-new-workspace', '1');
            }}
          >
            <Plus size={11} />
          </motion.button>
        </div>

        <div className={s.workspaceList}>
          {workspaces.length === 0 && (
            <p className={s.empty}>No workspaces yet.</p>
          )}

          {workspaces.map((w, i) => {
            const isConsoleOpen = !!onDashboard && viewMode === 'console' && w.id === activeWorkspaceId;
            const isWsHovered   = hoveredWsId === w.id;
            const isRunning     = localStorage.getItem(`orchaterm:conductor:running:${w.id}`) === 'true';

            return (
              <motion.div
                key={w.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.2 }}
              >
                <div
                  className={cx(s.wsRow, isConsoleOpen && s.wsRowActive)}
                  style={isConsoleOpen ? { '--ws-color': w.color } as CSSProperties : undefined}
                  onMouseEnter={() => setHoveredWsId(w.id)}
                  onMouseLeave={() => setHoveredWsId(null)}
                >
                  <button
                    className={s.wsClickArea}
                    onClick={() => openInConsole(w.id)}
                  >
                    {/* Workspace avatar */}
                    <span
                      className={s.wsAvatar}
                      style={{ backgroundColor: w.color + '22', borderColor: w.color + '44' }}
                    >
                      <span className={s.wsAvatarDot} style={{ backgroundColor: w.color }} />
                    </span>

                    <span className={s.wsName}>{w.name}</span>
                    {isRunning && <span className={s.wsRunDot} />}
                  </button>

                  <AnimatePresence>
                    {isWsHovered && (
                      <motion.div
                        className={s.wsActions}
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ duration: 0.12 }}
                      >
                        <button
                          className={cx(s.iconBtn, s.iconBtnDanger)}
                          title="Delete workspace"
                          onClick={() => {
                            if (window.confirm(`Delete "${w.name}"?`))
                              deleteWorkspace(w.id);
                          }}
                        >
                          <Trash2 size={10} />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* ── Navigation ── */}
        <nav className={s.nav}>
          <NavLink
            to="/"
            end
            className={cx(s.navBtn, isOverviewActive && s.navBtnActive)}
            onClick={() => setViewMode('grid')}
          >
            {() => (
              <>
                <LayoutDashboard className={s.navIcon} />
                <span>Overview</span>
              </>
            )}
          </NavLink>

          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClass}>
              {() => (
                <>
                  <Icon className={s.navIcon} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

      </div>

      {/* Footer */}
      <div className={s.footer}>
        <span className={s.footerLabel}>v0.1</span>
        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={toggleTheme}
          className={s.themeBtn}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark'
            ? <Sun className={s.themeIcon} />
            : <Moon className={s.themeIcon} />}
        </motion.button>
      </div>
    </aside>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const s = {
  sidebar: css`
    width: 248px;
    border-right: 1px solid var(--border-color);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    height: 100vh;
    flex-shrink: 0;
  `,

  /* Brand */
  brand: css`
    padding: 16px 14px 14px;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    gap: 10px;
    user-select: none;
    flex-shrink: 0;
  `,
  logo: css`
    width: 30px; height: 30px;
    border-radius: 9px;
    background: var(--gradient-brand);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 10px rgba(123, 104, 238, 0.35);
    flex-shrink: 0;
  `,
  logoIcon: css`width: 16px; height: 16px; color: #fff;`,
  title: css`
    font-size: 14px;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--text-primary);
    flex: 1;
  `,
  version: css`
    font-size: 10px;
    font-weight: 700;
    color: var(--color-brand);
    background: rgba(123, 104, 238, 0.14);
    padding: 1px 6px;
    border-radius: 99px;
  `,

  /* Body */
  body: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 10px 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
    &::-webkit-scrollbar { width: 3px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 99px; }
  `,

  /* Section header */
  sectionHead: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 6px;
    margin-bottom: 4px;
  `,
  sectionLabel: css`
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    user-select: none;
  `,
  addBtn: css`
    width: 20px; height: 20px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, color 0.15s;
    &:hover { background: rgba(123, 104, 238, 0.12); color: var(--color-brand); }
  `,

  /* Workspace list */
  workspaceList: css`
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-bottom: 8px;
  `,
  empty: css`
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 6px 10px;
    font-style: italic;
  `,

  /* Workspace row */
  wsRow: css`
    display: flex;
    align-items: center;
    border-radius: 8px;
    transition: background 0.15s;
    padding-right: 4px;
    position: relative;
    &:hover { background: var(--bg-hover); }
  `,
  wsRowActive: css`
    background: rgba(123, 104, 238, 0.10) !important;
  `,
  wsClickArea: css`
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 6px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    border-radius: 8px;
    transition: color 0.15s;
    &:hover { color: var(--text-primary); }
  `,
  wsAvatar: css`
    width: 22px; height: 22px;
    border-radius: 6px;
    border: 1px solid transparent;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  `,
  wsAvatarDot: css`
    width: 8px; height: 8px;
    border-radius: 50%;
  `,
  wsName: css`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  `,
  wsRunDot: css`
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--color-brand);
    flex-shrink: 0;
    animation: runPulse 1.6s ease-in-out infinite;
    @keyframes runPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
  `,
  wsActions: css`
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  `,

  /* Icon buttons */
  iconBtn: css`
    width: 22px; height: 22px;
    border-radius: 5px; border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.1s, color 0.1s;
    padding: 0;
    &:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); }
  `,
  iconBtnDanger: css`
    &:hover { background: rgba(248,113,113,0.15) !important; color: #f87171 !important; }
  `,

  /* Navigation */
  nav: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 0 16px;
    border-top: 1px solid var(--border-color);
    margin-top: 4px;
  `,
  navBtn: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    text-decoration: none;
    transition: color 0.15s, background 0.15s;
    position: relative;
    &:hover { color: var(--text-primary); background: var(--bg-hover); }
  `,
  navBtnActive: css`
    color: #fff !important;
    background: var(--color-brand) !important;
  `,
  navIcon: css`
    width: 15px; height: 15px; flex-shrink: 0;
  `,

  /* Footer */
  footer: css`
    padding: 12px 14px;
    border-top: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  `,
  footerLabel: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-weight: 600;
  `,
  themeBtn: css`
    width: 30px; height: 30px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    &:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--border-color-hover); }
  `,
  themeIcon: css`width: 14px; height: 14px;`,
};
