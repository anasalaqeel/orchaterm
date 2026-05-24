import React from 'react';
import { css } from '@emotion/css';
import { useNavigate } from 'react-router';
import { useDashboard } from '../../context/DashboardContext';
import { Link2, ArrowLeft, CheckCircle } from 'lucide-react';

interface SessionRegistryProps {
  workspaceId: string;
}

export const SessionRegistry: React.FC<SessionRegistryProps> = ({ workspaceId }) => {
  const { terminalSessions, agents, updateTerminalSession } = useDashboard();
  const navigate = useNavigate();

  const sessions = terminalSessions.filter(s => s.workspaceId === workspaceId);
  const assignedCount = sessions.filter(s => s.assignedAgentId).length;
  const allAssigned = sessions.length > 0 && assignedCount === sessions.length;

  // ── Empty state — guide user to open terminals in the workspace first ──────

  if (sessions.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyBody}>
          <span className={styles.emptyTitle}>No terminal sessions open</span>
          <span className={styles.emptyDesc}>
            Go back to your workspace, open terminal tabs and launch your agents,
            then assign them using the panel on the right.
          </span>
        </div>
        <button
          className={styles.backBtn}
          onClick={() => navigate('/')}
          title='Go to workspace terminal'
        >
          <ArrowLeft size={12} />
          Open Workspace
        </button>
      </div>
    );
  }

  // ── Populated state ────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Link2 className={styles.headerIcon} />
        <span className={styles.headerTitle}>Session Registry</span>
        <span className={styles.headerHint}>
          Assign or confirm which agent is running in each terminal
        </span>
        {allAssigned && (
          <span className={styles.allOkBadge}>
            <CheckCircle size={10} /> All assigned
          </span>
        )}
      </div>

      <div className={styles.grid}>
        {sessions.map(session => {
          const assigned = agents.find(a => a.id === session.assignedAgentId);
          return (
            <div key={session.id} className={styles.row}>
              <div className={styles.sessionInfo}>
                <span
                  className={styles.sessionDot}
                  style={{ backgroundColor: assigned?.color ?? '#334155' }}
                />
                <span className={styles.sessionTitle}>{session.title}</span>
              </div>
              <select
                className={styles.select}
                value={session.assignedAgentId ?? ''}
                onChange={e => updateTerminalSession(session.id, {
                  assignedAgentId: e.target.value || null,
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

      {/* Hint: primary assignment lives in the workspace panel */}
      {assignedCount < sessions.length && (
        <div className={styles.tip}>
          You can also assign sessions from the right-side panel in your workspace.
          <button className={styles.tipLink} onClick={() => navigate('/')}>
            Open workspace →
          </button>
        </div>
      )}
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
    flex: 1;
  `,
  allOkBadge: css`
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 700;
    color: #10b981;
    flex-shrink: 0;
  `,

  grid: css`
    display: flex;
    flex-direction: column;
  `,
  row: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border-color);
    gap: 12px;
    &:last-child { border-bottom: none; }
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
    transition: background-color 0.2s;
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
    &:focus { border-color: var(--color-brand); }
  `,

  /* tip row at bottom */
  tip: css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-top: 1px solid var(--border-color);
    font-size: 10px;
    color: var(--text-tertiary);
    background: var(--bg-primary);
  `,
  tipLink: css`
    background: none;
    border: none;
    cursor: pointer;
    font-size: 10px;
    color: var(--color-brand);
    padding: 0;
    font-weight: 600;
    &:hover { text-decoration: underline; }
  `,

  /* empty state */
  empty: css`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    background-color: var(--bg-secondary);
  `,
  emptyBody: css`
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  `,
  emptyTitle: css`
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  `,
  emptyDesc: css`
    font-size: 10px;
    color: var(--text-tertiary);
    line-height: 1.5;
  `,
  backBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: var(--border-radius-sm);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: border-color 0.15s, color 0.15s;
    &:hover { border-color: var(--color-brand); color: var(--color-brand); }
  `,
};
