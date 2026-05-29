import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { NavLink, useNavigate, useMatch } from 'react-router';
import { css, cx } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import { useDashboard } from '../../context/DashboardContext';
import {
  History, Sparkles, Settings,
  Sun, Moon, LayoutDashboard,
  Plus, Trash2, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import logoDark from '../../assets/logo-icon-dark-theme.svg';
import logoLight from '../../assets/logo-icon-light-theme.svg';

const NAV_ITEMS = [
  { to: '/logs',     label: 'Task Log',     icon: History },
  { to: '/prompts',  label: 'Prompt Vault', icon: Sparkles },
  { to: '/settings', label: 'Settings',     icon: Settings },
] as const;

const W_EXPANDED  = 248;
const W_COLLAPSED =  56;
const ANIM_MS     = 220; // must match the motion transition duration

export function Sidebar() {
  const {
    theme, toggleTheme,
    workspaces, activeWorkspaceId, setActiveWorkspaceId,
    deleteWorkspace,
    viewMode, setViewMode,
    setNewWorkspaceModalOpen,
  } = useDashboard();

  const navigate    = useNavigate();
  const onDashboard = useMatch('/');

  const [hoveredWsId, setHoveredWsId] = useState<string | null>(null);

  // Lazy initialisers so localStorage is only read once (on mount).
  const [collapsed,       setCollapsed]       = useState<boolean>(
    () => localStorage.getItem('orchaterm:sidebar-collapsed') === '1',
  );
  // layoutCollapsed drives CSS centering classes. It trails `collapsed` by
  // ANIM_MS when collapsing (waits for the width to finish shrinking) but
  // updates immediately when expanding so items don't stay centred while
  // the sidebar is still opening.
  const [layoutCollapsed, setLayoutCollapsed] = useState<boolean>(
    () => localStorage.getItem('orchaterm:sidebar-collapsed') === '1',
  );

  // Keep a ref to the pending timer so we can cancel it if the component
  // unmounts before the animation finishes.
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (collapseTimerRef.current !== null) clearTimeout(collapseTimerRef.current);
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('orchaterm:sidebar-collapsed', next ? '1' : '0');
    if (collapseTimerRef.current !== null) clearTimeout(collapseTimerRef.current);
    if (next) {
      // Collapsing — delay centering until the width animation is done.
      collapseTimerRef.current = setTimeout(() => setLayoutCollapsed(true), ANIM_MS);
    } else {
      // Expanding — restore left-alignment immediately.
      setLayoutCollapsed(false);
    }
  };

  const openInConsole = (id: string) => {
    setActiveWorkspaceId(id);
    setViewMode('console');
    navigate('/');
  };

  const isOverviewActive = !!onDashboard && viewMode === 'grid';
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cx(s.navBtn, layoutCollapsed && s.navBtnCollapsed, isActive && s.navBtnActive);

  return (
    <motion.aside
      className={s.sidebar}
      animate={{ width: collapsed ? W_COLLAPSED : W_EXPANDED }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
    >

      {/* Brand */}
      <div className={cx(s.brand, layoutCollapsed && s.brandCollapsed)}>
        <div className={s.logo}>
          <img src={theme === 'dark' ? logoDark : logoLight} className={s.logoIcon} alt="Orchaterm" />
        </div>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              className={s.brandText}
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.18 }}
            >
              <h1 className={s.title}>Orchaterm</h1>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={s.body}>

        {/* ── Workspaces ── */}
        <div className={cx(s.sectionHead, layoutCollapsed && s.sectionHeadCollapsed)}>
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                className={s.sectionLabel}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                Workspaces
              </motion.span>
            )}
          </AnimatePresence>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.92 }}
            className={s.addBtn}
            title="New Workspace"
            onClick={() => {
              setViewMode('grid');
              navigate('/');
              setNewWorkspaceModalOpen(true);
            }}
          >
            <Plus size={11} />
          </motion.button>
        </div>

        <div className={s.workspaceList}>
          {workspaces.length === 0 && !collapsed && (
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
                  className={cx(s.wsRow, isConsoleOpen && s.wsRowActive, layoutCollapsed && s.wsRowCollapsed)}
                  style={isConsoleOpen ? { '--ws-color': w.color } as CSSProperties : undefined}
                  onMouseEnter={() => setHoveredWsId(w.id)}
                  onMouseLeave={() => setHoveredWsId(null)}
                  title={collapsed ? w.name : undefined}
                >
                  <button
                    className={cx(s.wsClickArea, layoutCollapsed && s.wsClickAreaCollapsed)}
                    onClick={() => openInConsole(w.id)}
                  >
                    <span
                      className={s.wsAvatar}
                      style={{ backgroundColor: w.color + '22', borderColor: w.color + '44' }}
                    >
                      <span className={s.wsAvatarDot} style={{ backgroundColor: w.color }} />
                    </span>

                    <AnimatePresence initial={false}>
                      {!collapsed && (
                        <motion.span
                          className={s.wsName}
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: 'auto' }}
                          exit={{ opacity: 0, width: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          {w.name}
                        </motion.span>
                      )}
                    </AnimatePresence>

                    {isRunning && <span className={s.wsRunDot} />}
                  </button>

                  <AnimatePresence>
                    {isWsHovered && !collapsed && (
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
            className={cx(s.navBtn, layoutCollapsed && s.navBtnCollapsed, isOverviewActive && s.navBtnActive)}
            onClick={() => setViewMode('grid')}
            title={collapsed ? 'Overview' : undefined}
          >
            {() => (
              <>
                <LayoutDashboard className={s.navIcon} />
                <AnimatePresence initial={false}>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      Overview
                    </motion.span>
                  )}
                </AnimatePresence>
              </>
            )}
          </NavLink>

          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={navLinkClass}
              title={collapsed ? label : undefined}
            >
              {() => (
                <>
                  <Icon className={s.navIcon} />
                  <AnimatePresence initial={false}>
                    {!collapsed && (
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: 'auto' }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        {label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </>
              )}
            </NavLink>
          ))}
        </nav>

      </div>

      {/* Footer */}
      <div className={cx(s.footer, layoutCollapsed && s.footerCollapsed)}>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              className={s.footerLabel}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              v0.1
            </motion.span>
          )}
        </AnimatePresence>

        <div className={cx(s.footerActions, layoutCollapsed && s.footerActionsCollapsed)}>
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={toggleTheme}
            className={s.footerBtn}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark'
              ? <Sun className={s.themeIcon} />
              : <Moon className={s.themeIcon} />}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={toggleCollapsed}
            className={s.footerBtn}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed
              ? <ChevronsRight className={s.themeIcon} />
              : <ChevronsLeft  className={s.themeIcon} />}
          </motion.button>
        </div>
      </div>
    </motion.aside>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const s = {
  sidebar: css`
    border-right: 1px solid var(--border-color);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    height: 100vh;
    flex-shrink: 0;
    overflow: hidden;          /* clip content during width animation */
    will-change: width;
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
    min-width: 0;
  `,
  brandCollapsed: css`
    padding: 16px 0 14px;
    justify-content: center;
  `,
  brandText: css`
    display: flex; align-items: center; gap: 8px;
    overflow: hidden; white-space: nowrap; min-width: 0;
  `,
  logo: css`
    width: 30px; height: 30px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  `,
  logoIcon: css`width: 22px; height: 22px; object-fit: contain;`,
  title: css`
    font-size: 14px;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--text-primary);
    white-space: nowrap;
  `,
  version: css`
    font-size: 10px;
    font-weight: 700;
    color: var(--color-brand);
    background: rgba(123, 104, 238, 0.14);
    padding: 1px 6px;
    border-radius: 99px;
    white-space: nowrap;
  `,

  /* Body */
  body: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
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
    min-width: 0;
  `,
  sectionHeadCollapsed: css`
    justify-content: center;
    padding: 0;
  `,
  sectionLabel: css`
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
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
    flex-shrink: 0;
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
    white-space: nowrap;
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
  wsRowCollapsed: css`
    padding-right: 0;
    justify-content: center;
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
  wsClickAreaCollapsed: css`
    flex: none;
    padding: 7px;
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
    white-space: nowrap;
    overflow: hidden;
    &:hover { color: var(--text-primary); background: var(--bg-hover); }
  `,
  navBtnCollapsed: css`
    justify-content: center;
    padding: 8px;
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
  footerCollapsed: css`
    padding: 10px 0;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  `,
  footerLabel: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-weight: 600;
    white-space: nowrap;
  `,
  footerActions: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  footerActionsCollapsed: css`
    flex-direction: column;
    gap: 4px;
  `,
  footerBtn: css`
    width: 30px; height: 30px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    flex-shrink: 0;
    &:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--border-color-hover); }
  `,
  themeIcon: css`width: 14px; height: 14px;`,
};
