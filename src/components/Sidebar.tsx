import React from 'react';
import { css, cx } from '@emotion/css';
import { useDashboard } from '../context/DashboardContext';
import { Cpu, History, Sparkles, Settings, Sun, Moon, Blocks, LayoutDashboard } from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { 
    activeView, 
    setActiveView, 
    theme, 
    toggleTheme, 
    workspaces, 
    activeWorkspaceId, 
    setActiveWorkspaceId,
    viewMode,
    setViewMode
  } = useDashboard();

  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'agents', label: 'Agents', icon: Cpu },
    { id: 'logs', label: 'Task Log', icon: History },
    { id: 'prompts', label: 'Prompt Vault', icon: Sparkles },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className={styles.sidebar}>
      {/* Brand Header */}
      <div className={styles.header}>
        <div className={styles.logoContainer}>
          <Blocks className={styles.logoIcon} />
        </div>
        <div className={styles.titleContainer}>
          <h1 className={styles.title}>AgentDeck</h1>
          <span className={styles.subtitle}>Developer Hub</span>
        </div>
      </div>

      {/* Workspaces List Section */}
      <div className={styles.contentArea}>
        <span className={styles.sectionTitle}>Workspaces</span>
        <div className={styles.workspaceList}>
          {workspaces.map((w) => {
            const isActive = w.id === activeWorkspaceId && activeView === 'dashboard';
            return (
              <button
                key={w.id}
                onClick={() => {
                  setActiveWorkspaceId(w.id);
                  setActiveView('dashboard');
                  setViewMode('console');
                }}
                className={cx(styles.workspaceButton, isActive && styles.workspaceActive)}
              >
                <div className={styles.workspaceButtonLeft}>
                  <span className={styles.workspaceDot} style={{ backgroundColor: w.color || '#3b82f6' }} />
                  <span className={styles.workspaceName}>{w.name}</span>
                </div>
              </button>
            );
          })}
          {workspaces.length === 0 && (
            <p className={styles.emptyWorkspaces}>No workspaces added.</p>
          )}
        </div>

        <div className={styles.divider} />

        {/* Navigation Items */}
        <span className={styles.sectionTitle}>Navigation</span>
        <nav className={styles.navList}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            const isNavActive = isActive && (activeView === item.id || (item.id === 'dashboard' && viewMode === 'grid'));
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveView(item.id);
                  if (item.id === 'dashboard') {
                    setViewMode('grid');
                  }
                }}
                className={cx(styles.navButton, isNavActive && styles.navActive)}
              >
                <Icon />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Footer / Theme Switcher */}
      <div className={styles.footer}>
        <div className={styles.footerVersion}>v0.1.0 (Beta)</div>
        <button
          onClick={toggleTheme}
          className={styles.themeToggle}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </button>
      </div>
    </aside>
  );
};

const styles = {
  sidebar: css`
    width: 256px;
    border-right: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    backdrop-filter: blur(24px);
    display: flex;
    flex-direction: column;
    height: 100vh;
    flex-shrink: 0;
    transition: background-color 0.3s ease, border-color 0.3s ease;
  `,
  header: css`
    padding: var(--spacing-lg);
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    gap: 12px;
    user-select: none;
  `,
  logoContainer: css`
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background-color: #FF9D00;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 15px -3px rgba(255, 157, 0, 0.2);
    color: #0d2131;
    font-weight: 800;
  `,
  logoIcon: css`
    width: 20px;
    height: 20px;
  `,
  titleContainer: css`
    display: flex;
    flex-direction: column;
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
  contentArea: css`
    padding: var(--spacing-lg) var(--spacing-md) 0;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    gap: var(--spacing-sm);
  `,
  sectionTitle: css`
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
    overflow-y: auto;
    max-height: 45%;
    padding-right: 4px;
  `,
  workspaceButton: css`
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    transition: all 0.2s ease-in-out;
    border: none;
    border-left: 2px solid transparent;
    cursor: pointer;
    background: transparent;
    color: var(--text-secondary);

    &:hover {
      color: var(--text-primary);
      background-color: var(--bg-hover);
    }
  `,
  workspaceActive: css`
    background-color: var(--bg-hover);
    border-left-color: var(--color-primary);
    color: var(--color-primary);

    &:hover {
      color: var(--color-primary);
      background-color: var(--bg-hover);
    }
  `,
  workspaceButtonLeft: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  `,
  workspaceDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    animation: pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;

    @keyframes pulse-dot {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
    }
  `,
  workspaceName: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  emptyWorkspaces: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-style: italic;
    padding: 0 var(--spacing-sm);
  `,
  divider: css`
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 12px 0;
  `,
  navList: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    padding-right: 4px;
  `,
  navButton: css`
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    transition: all 0.2s ease-in-out;
    position: relative;
    cursor: pointer;
    border: none;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--text-secondary);

    svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      transition: transform 0.2s ease-in-out, color 0.2s ease-in-out;
      color: var(--text-secondary);
    }

    &:hover {
      color: var(--text-primary);
      background-color: var(--bg-hover);

      svg {
        transform: scale(1.1);
        color: var(--text-primary);
      }
    }
  `,
  navActive: css`
    background-color: var(--bg-hover);
    color: var(--color-primary);
    border-left-color: var(--color-primary);

    svg {
      color: var(--color-primary);
    }

    &:hover {
      color: var(--color-primary);
      background-color: var(--bg-hover);

      svg {
        color: var(--color-primary);
      }
    }
  `,
  footer: css`
    padding: var(--spacing-md);
    border-top: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  footerVersion: css`
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-weight: var(--font-weight-medium);
  `,
  themeToggle: css`
    padding: 8px;
    border-radius: var(--border-radius-sm);
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color 0.2s, color 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;

    svg {
      width: 16px;
      height: 16px;
    }

    &:hover {
      background-color: var(--bg-hover);
      color: var(--text-primary);
    }
  `
};
