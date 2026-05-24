/**
 * WorkspacePanel.tsx
 *
 * Right-side panel in the Workspace Console view.
 * Shows live workspace context: open terminal sessions with agent assignments
 * (the primary place to wire sessions to agents before running the Conductor),
 * current task, conductor plan status, and recent task logs.
 */

import React, { useState, useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import {
  Edit2, Check, X, Terminal, Activity,
  ClipboardList, Clock, AlertTriangle, CheckCircle2,
  Loader2, ArrowRight, Link2, UserCheck,
} from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { Workspace, Agent, TaskLog, OrchestratorPlan } from '../../types';
import { orchestratorEngine } from '../../services/orchestratorEngine';

interface WorkspacePanelProps {
  workspace: Workspace;
}

// ─── Task status helpers ───────────────────────────────────────────────────────

const LOG_STATUS_COLOR: Record<TaskLog['status'], string> = {
  'in-progress': '#FF9D00',
  done:          '#10b981',
  blocked:       '#ef4444',
};

const LOG_STATUS_ICON: Record<TaskLog['status'], React.FC<{ size?: number; className?: string }>> = {
  'in-progress': Loader2,
  done:          CheckCircle2,
  blocked:       AlertTriangle,
};

function formatLogTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

// ─── Conductor mini-status ─────────────────────────────────────────────────────

interface ConductorStatusProps { plan: OrchestratorPlan | null }

const ConductorStatus: React.FC<ConductorStatusProps> = ({ plan }) => {
  if (!plan) {
    return (
      <div className={s.noplan}>
        <ArrowRight size={10} />
        <span>No plan running</span>
      </div>
    );
  }

  const counts = { pending: 0, running: 0, done: 0, failed: 0 };
  plan.tasks.forEach(t => counts[t.status]++);
  const total     = plan.tasks.length;
  const progress  = total > 0 ? (counts.done / total) * 100 : 0;
  const hasFailed = counts.failed > 0;

  const statusColor =
    plan.status === 'done'    ? '#10b981' :
    plan.status === 'failed'  ? '#ef4444' :
    plan.status === 'running' ? '#FF9D00' :
    plan.status === 'paused'  ? '#a78bfa' :
    '#475569';

  return (
    <div className={s.planCard}>
      <div className={s.planCardHeader}>
        <span className={s.planGoal}>{plan.goal}</span>
        <span className={s.planStatus} style={{ color: statusColor }}>
          {plan.status.toUpperCase()}
        </span>
      </div>

      <div className={s.planBar}>
        <div
          className={s.planFill}
          style={{
            width: `${progress}%`,
            backgroundColor: hasFailed ? '#ef4444' : '#10b981',
          }}
        />
      </div>

      <div className={s.planCounts}>
        {counts.running > 0 && (
          <span className={s.countBadge} style={{ color: '#FF9D00' }}>
            {counts.running} running
          </span>
        )}
        {counts.done > 0 && (
          <span className={s.countBadge} style={{ color: '#10b981' }}>
            {counts.done} done
          </span>
        )}
        {counts.failed > 0 && (
          <span className={s.countBadge} style={{ color: '#ef4444' }}>
            {counts.failed} failed
          </span>
        )}
        {counts.pending > 0 && (
          <span className={s.countBadge} style={{ color: '#64748b' }}>
            {counts.pending} pending
          </span>
        )}
        <span className={s.countTotal}>{total} tasks total</span>
      </div>

      {/* Running tasks list */}
      {plan.tasks.filter(t => t.status === 'running').map(t => (
        <div key={t.id} className={s.runningTask}>
          <span className={s.runningDot} />
          <span className={s.runningTitle}>{t.title}</span>
          {t.startedAt && (
            <span className={s.runningDuration}>
              {formatDuration(Date.now() - t.startedAt)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

// ─── WorkspacePanel ────────────────────────────────────────────────────────────

export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({ workspace }) => {
  const {
    agents, taskLogs, terminalSessions,
    updateWorkspace, updateTerminalSession, showToast,
  } = useDashboard();

  // Sessions open in this workspace
  const workspaceSessions = terminalSessions.filter(s => s.workspaceId === workspace.id);
  const assignedCount = workspaceSessions.filter(s => s.assignedAgentId).length;

  // Current task inline edit
  const [editingTask, setEditingTask] = useState(false);
  const [taskDraft, setTaskDraft]     = useState(workspace.currentTask);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Live conductor plan
  const [livePlan, setLivePlan] = useState<OrchestratorPlan | null>(null);

  // Subscribe to orchestrator state
  useEffect(() => {
    const unsub = orchestratorEngine.onStateChange((plan) => {
      setLivePlan({ ...plan });
    });
    return unsub;
  }, []);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editingTask) textareaRef.current?.focus();
  }, [editingTask]);

  // Keep draft in sync when workspace prop changes (e.g. switching workspace)
  useEffect(() => {
    setTaskDraft(workspace.currentTask);
    setEditingTask(false);
  }, [workspace.id, workspace.currentTask]);

  const assignedAgent: Agent | undefined = agents.find(a => a.id === workspace.agentId);

  const recentLogs: TaskLog[] = taskLogs
    .filter(l => l.workspaceId === workspace.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 6);

  const handleSaveTask = () => {
    updateWorkspace(workspace.id, { currentTask: taskDraft });
    showToast('Current task updated', 'success');
    setEditingTask(false);
  };

  const handleCancelTask = () => {
    setTaskDraft(workspace.currentTask);
    setEditingTask(false);
  };

  const handleTaskKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSaveTask(); }
    if (e.key === 'Escape') handleCancelTask();
  };

  return (
    <div className={s.root}>

      {/* ── Header ── */}
      <div className={s.header}>
        <span className={s.headerDot} style={{ backgroundColor: workspace.color }} />
        <span className={s.headerName}>{workspace.name}</span>
        <span className={s.headerStatus} style={{
          color:
            workspace.status === 'active' ? '#10b981' :
            workspace.status === 'paused' ? '#FF9D00' : '#64748b',
        }}>
          {workspace.status.toUpperCase()}
        </span>
      </div>

      <div className={s.headerPath}>{workspace.path}</div>

      <div className={s.divider} />

      {/* ── Terminal Sessions → Agent Assignment ── */}
      {/* This is the PRIMARY place to assign agents to terminal sessions
          before heading to the Conductor to build and run a plan. */}
      <div className={s.section}>
        <div className={s.sectionRow}>
          <span className={s.sectionLabel}>
            <Link2 size={11} />
            Terminal Sessions
          </span>
          {workspaceSessions.length > 0 && (
            <span className={s.sessionBadge}>
              {assignedCount}/{workspaceSessions.length} assigned
            </span>
          )}
        </div>

        {workspaceSessions.length === 0 ? (
          <div className={s.sessionsEmpty}>
            <Terminal size={12} />
            <span>Open tabs in the left terminal panel, then assign an agent to each one here.</span>
          </div>
        ) : (
          <div className={s.sessionList}>
            {workspaceSessions.map(session => {
              const assigned = agents.find(a => a.id === session.assignedAgentId);
              return (
                <div key={session.id} className={s.sessionRow}>
                  <div className={s.sessionMeta}>
                    <span
                      className={s.sessionDot}
                      style={{ backgroundColor: assigned?.color ?? '#334155' }}
                    />
                    <span className={s.sessionName}>{session.title}</span>
                  </div>
                  <select
                    className={s.sessionSelect}
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
        )}

      </div>

      <div className={s.divider} />

      {/* ── Current Task ── */}
      <div className={s.section}>
        <div className={s.sectionRow}>
          <span className={s.sectionLabel}>
            <ClipboardList size={11} />
            Current Task
          </span>
          {!editingTask && (
            <button className={s.iconBtn} onClick={() => setEditingTask(true)} title='Edit task'>
              <Edit2 size={11} />
            </button>
          )}
        </div>

        {editingTask ? (
          <div className={s.taskEditArea}>
            <textarea
              ref={textareaRef}
              className={s.taskTextarea}
              value={taskDraft}
              onChange={e => setTaskDraft(e.target.value)}
              onKeyDown={handleTaskKeyDown}
              rows={3}
              placeholder='Describe what this agent is working on…'
            />
            <div className={s.taskEditBtns}>
              <button className={s.saveBtn} onClick={handleSaveTask}>
                <Check size={11} /> Save
              </button>
              <button className={s.cancelBtn} onClick={handleCancelTask}>
                <X size={11} /> Cancel
              </button>
              <span className={s.taskHint}>Ctrl+Enter to save</span>
            </div>
          </div>
        ) : (
          <div
            className={s.taskText}
            onClick={() => setEditingTask(true)}
            title='Click to edit'
          >
            {workspace.currentTask || <span className={s.taskEmpty}>No task set — click to add one</span>}
          </div>
        )}
      </div>

      <div className={s.divider} />

      {/* ── Assigned Agent (workspace default) ── */}
      <div className={s.section}>
        <span className={s.sectionLabel}>
          <UserCheck size={11} />
          Default Agent
        </span>

        {assignedAgent ? (
          <div className={s.agentChip}>
            <span className={s.agentDot} style={{ backgroundColor: assignedAgent.color }} />
            <span className={s.agentName}>{assignedAgent.name}</span>
            {assignedAgent.launchCommand && (
              <code className={s.agentCmd}>{assignedAgent.launchCommand}</code>
            )}
          </div>
        ) : (
          <div className={s.noAgent}>
            No default agent — assign one in the grid view
          </div>
        )}

        {assignedAgent?.launchCommand && (
          <div className={s.launchHint}>
            <span className={s.launchHintLabel}>Launch in left terminal:</span>
            <code className={s.launchCmd}>{assignedAgent.launchCommand}</code>
          </div>
        )}
      </div>

      <div className={s.divider} />

      {/* ── Conductor Status ── */}
      <div className={s.section}>
        <span className={s.sectionLabel}>
          <Activity size={11} />
          Conductor
        </span>
        <ConductorStatus plan={livePlan} />
      </div>

      <div className={s.divider} />

      {/* ── Recent Task Logs ── */}
      <div className={s.section}>
        <span className={s.sectionLabel}>
          <Clock size={11} />
          Recent Task Logs
        </span>

        {recentLogs.length === 0 ? (
          <div className={s.emptyLogs}>No task logs for this workspace yet</div>
        ) : (
          <div className={s.logList}>
            {recentLogs.map(log => {
              const Icon = LOG_STATUS_ICON[log.status];
              const logAgent = agents.find(a => a.id === log.agentId);
              return (
                <div key={log.id} className={s.logItem}>
                  <Icon size={11} style={{ color: LOG_STATUS_COLOR[log.status], flexShrink: 0, marginTop: 1 }} />
                  <div className={s.logBody}>
                    <span className={s.logSummary}>{log.summary}</span>
                    <div className={s.logMeta}>
                      {logAgent && (
                        <span className={s.logAgent} style={{ color: logAgent.color }}>
                          {logAgent.name}
                        </span>
                      )}
                      <span className={s.logTime}>{formatLogTime(log.timestamp)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  root: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    background: var(--bg-primary);

    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
    &::-webkit-scrollbar-track { background: transparent; }
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px 4px;
  `,
  headerDot: css`
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  headerName: css`
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  headerStatus: css`
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
  `,
  headerPath: css`
    padding: 0 16px 10px;
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  divider: css`
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 0;
  `,
  section: css`
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  sectionRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  sectionLabel: css`
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
  `,
  iconBtn: css`
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    padding: 2px 4px;
    border-radius: 3px;
    transition: color 0.15s, background-color 0.15s;
    &:hover { color: var(--text-primary); background-color: var(--bg-hover); }
  `,

  /* ── Terminal Sessions ── */
  sessionBadge: css`
    font-size: 9px;
    font-weight: 700;
    color: var(--color-brand);
    background: color-mix(in srgb, var(--color-brand) 12%, transparent);
    padding: 1px 6px;
    border-radius: 10px;
  `,
  sessionsEmpty: css`
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 8px 10px;
    border: 1px dashed var(--border-color);
    border-radius: 6px;
    font-size: 11px;
    color: var(--text-tertiary);
    line-height: 1.5;
    background: var(--bg-secondary);
  `,
  sessionList: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  sessionRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    transition: border-color 0.15s;
    &:hover { border-color: var(--color-brand); }
  `,
  sessionMeta: css`
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  `,
  sessionDot: css`
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background-color 0.2s;
  `,
  sessionName: css`
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  sessionSelect: css`
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 10px;
    color: var(--text-primary);
    outline: none;
    cursor: pointer;
    flex-shrink: 0;
    max-width: 120px;
    transition: border-color 0.15s;
    &:focus { border-color: var(--color-brand); }
  `,
  /* Current Task */
  taskText: css`
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.6;
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 4px;
    border: 1px solid transparent;
    transition: border-color 0.15s, background-color 0.15s;
    min-height: 36px;
    &:hover { border-color: var(--border-color); background-color: var(--bg-secondary); }
  `,
  taskEmpty: css`
    color: var(--text-tertiary);
    font-style: italic;
  `,
  taskEditArea: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  taskTextarea: css`
    width: 100%;
    box-sizing: border-box;
    background-color: var(--bg-secondary);
    border: 1px solid var(--color-brand);
    border-radius: 4px;
    padding: 8px;
    font-size: 12px;
    color: var(--text-primary);
    font-family: inherit;
    resize: vertical;
    outline: none;
    line-height: 1.6;
    &::placeholder { color: var(--text-tertiary); }
  `,
  taskEditBtns: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  saveBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background-color: var(--color-brand);
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    &:hover { opacity: 0.85; }
  `,
  cancelBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background-color: var(--bg-hover);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    &:hover { color: var(--text-primary); }
  `,
  taskHint: css`
    font-size: 10px;
    color: var(--text-tertiary);
    margin-left: auto;
  `,

  /* Default Agent */
  agentChip: css`
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px;
    background-color: var(--bg-secondary);
    border-radius: 6px;
    border: 1px solid var(--border-color);
  `,
  agentDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  agentName: css`
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
  `,
  agentCmd: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: 'JetBrains Mono', monospace;
    background: var(--bg-primary);
    padding: 1px 5px;
    border-radius: 3px;
  `,
  noAgent: css`
    font-size: 11px;
    color: var(--text-tertiary);
    font-style: italic;
  `,
  launchHint: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    background-color: var(--bg-secondary);
    border-radius: 4px;
    border: 1px solid var(--border-color);
  `,
  launchHintLabel: css`
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-tertiary);
  `,
  launchCmd: css`
    font-size: 11px;
    color: #FF9D00;
    font-family: 'JetBrains Mono', 'Cascadia Code', monospace;
    word-break: break-all;
  `,

  /* Conductor status */
  noplan: css`
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 6px 0;
  `,
  planCard: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background-color: var(--bg-secondary);
    border-radius: 6px;
    border: 1px solid var(--border-color);
  `,
  planCardHeader: css`
    display: flex;
    align-items: flex-start;
    gap: 8px;
  `,
  planGoal: css`
    font-size: 11px;
    color: var(--text-secondary);
    flex: 1;
    line-height: 1.4;
  `,
  planStatus: css`
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.07em;
    flex-shrink: 0;
  `,
  planBar: css`
    height: 3px;
    background-color: var(--border-color);
    border-radius: 2px;
    overflow: hidden;
  `,
  planFill: css`
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s ease;
  `,
  planCounts: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  `,
  countBadge: css`
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  `,
  countTotal: css`
    font-size: 9px;
    color: var(--text-tertiary);
    margin-left: auto;
  `,
  runningTask: css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
    border-top: 1px solid var(--border-color);
  `,
  runningDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #FF9D00;
    flex-shrink: 0;
    animation: pulse 1.4s ease-in-out infinite;
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.3; }
    }
  `,
  runningTitle: css`
    font-size: 11px;
    color: var(--text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  runningDuration: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: monospace;
    flex-shrink: 0;
  `,

  /* Task Logs */
  emptyLogs: css`
    font-size: 11px;
    color: var(--text-tertiary);
    font-style: italic;
    padding: 4px 0;
  `,
  logList: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  logItem: css`
    display: flex;
    align-items: flex-start;
    gap: 7px;
  `,
  logBody: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  `,
  logSummary: css`
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  `,
  logMeta: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  logAgent: css`
    font-size: 9px;
    font-weight: 700;
  `,
  logTime: css`
    font-size: 9px;
    color: var(--text-tertiary);
  `,
};
