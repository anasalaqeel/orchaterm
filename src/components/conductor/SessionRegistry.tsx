import React from 'react';
import { css } from '@emotion/css';
import { useDashboard } from '../../context/DashboardContext';
import { Link2, AlertCircle } from 'lucide-react';

interface SessionRegistryProps {
  workspaceId: string;
}

export const SessionRegistry: React.FC<SessionRegistryProps> = ({ workspaceId }) => {
  const { terminalSessions, agents, updateTerminalSession } = useDashboard();

  const sessions = terminalSessions.filter(s => s.workspaceId === workspaceId);

  if (sessions.length === 0) {
    return (
      <div className={styles.empty}>
        <AlertCircle className={styles.emptyIcon} />
        <p>No active terminal sessions. Open the workspace and launch terminals first.</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Link2 className={styles.headerIcon} />
        <span className={styles.headerTitle}>Session Registry</span>
        <span className={styles.headerHint}>Assign each terminal to its agent</span>
      </div>
      <div className={styles.grid}>
        {sessions.map(session => {
          const assigned = agents.find(a => a.id === session.assignedAgentId);
          return (
            <div key={session.id} className={styles.row}>
              <div className={styles.sessionInfo}>
                <span className={styles.sessionDot}
                  style={{ backgroundColor: assigned?.color ?? '#475569' }}
                />
                <span className={styles.sessionTitle}>{session.title}</span>
              </div>
              <select
                className={styles.select}
                value={session.assignedAgentId ?? ''}
                onChange={e => updateTerminalSession(session.id, {
                  assignedAgentId: e.target.value || null
                })}
              >
                <option value=''>— Unassigned —</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const styles = {
  root: css`
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    background-color: var(--bg-secondary);
    overflow: hidden;
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-primary);
  `,
  headerIcon: css`
    width: 14px;
    height: 14px;
    color: var(--color-brand);
    flex-shrink: 0;
  `,
  headerTitle: css`
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  `,
  headerHint: css`
    font-size: 10px;
    color: var(--text-tertiary);
    margin-left: 4px;
  `,
  grid: css`
    display: flex;
    flex-direction: column;
    gap: 0;
  `,
  row: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border-color);
    gap: 12px;

    &:last-child {
      border-bottom: none;
    }
  `,
  sessionInfo: css`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  `,
  sessionDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  sessionTitle: css`
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  select: css`
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 4px 8px;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    outline: none;
    cursor: pointer;
    min-width: 160px;
    transition: border-color 0.15s;

    &:focus {
      border-color: var(--color-brand);
    }
  `,
  empty: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    background-color: var(--bg-secondary);
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
  `,
  emptyIcon: css`
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--color-brand);
    opacity: 0.5;
  `,
};
