import React, { useState, useEffect, useRef } from 'react';
import { css, cx } from '@emotion/css';
import { Edit2, Check, X, Terminal, Activity, Clock, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { Workspace, TaskLog, OrchestratorPlan } from '../../types';
import { orchestratorEngine } from '../../services/orchestratorEngine';

interface WorkspacePanelProps { workspace: Workspace }

const LOG_STATUS_COLOR: Record<TaskLog['status'], string> = {
  'in-progress': '#e3b341',
  done:          '#3fb950',
  blocked:       '#f85149',
};
const LOG_STATUS_ICON: Record<TaskLog['status'], React.FC<{ size?: number }>> = {
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

const ConductorStatus: React.FC<{ plan: OrchestratorPlan | null }> = ({ plan }) => {
  if (!plan) return <p className={s.muted}>No plan running</p>;

  const counts = { pending: 0, running: 0, done: 0, failed: 0 };
  plan.tasks.forEach(t => counts[t.status]++);
  const total    = plan.tasks.length;
  const progress = total > 0 ? (counts.done / total) * 100 : 0;
  const color    = plan.status === 'done' ? '#3fb950' : plan.status === 'failed' ? '#f85149' :
                   plan.status === 'running' ? '#ff9d00' : '#8b949e';

  return (
    <div className={s.planWrap}>
      <div className={s.planTop}>
        <span className={s.planGoal}>{plan.goal}</span>
        <span className={s.planState} style={{ color }}>{plan.status}</span>
      </div>
      <div className={s.bar}><div className={s.barFill} style={{ width: `${progress}%`, background: color }} /></div>
      <div className={s.planMeta}>
        {counts.running > 0 && <span style={{ color: '#e3b341' }}>{counts.running} running</span>}
        {counts.done > 0    && <span style={{ color: '#3fb950' }}>{counts.done} done</span>}
        {counts.failed > 0  && <span style={{ color: '#f85149' }}>{counts.failed} failed</span>}
        {counts.pending > 0 && <span style={{ color: '#6e7681' }}>{counts.pending} pending</span>}
      </div>
      {plan.tasks.filter(t => t.status === 'running').map(t => (
        <div key={t.id} className={s.runningRow}>
          <span className={s.runDot} />
          <span className={s.runTitle}>{t.title}</span>
          {t.startedAt && <span className={s.runTime}>{formatDuration(Date.now() - t.startedAt)}</span>}
        </div>
      ))}
    </div>
  );
};

export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({ workspace }) => {
  const { taskLogs, terminalSessions, updateWorkspace, showToast } = useDashboard();
  const sessions = terminalSessions.filter(s => s.workspaceId === workspace.id);

  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState(workspace.currentTask);
  const [livePlan, setLivePlan] = useState<OrchestratorPlan | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { return orchestratorEngine.onStateChange(p => setLivePlan({ ...p })); }, []);
  useEffect(() => { if (editing) textareaRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(workspace.currentTask); setEditing(false); }, [workspace.id, workspace.currentTask]);

  const recentLogs = taskLogs
    .filter(l => l.workspaceId === workspace.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  const save = () => { updateWorkspace(workspace.id, { currentTask: draft }); showToast('Saved', 'success'); setEditing(false); };
  const cancel = () => { setDraft(workspace.currentTask); setEditing(false); };
  const keydown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    if (e.key === 'Escape') cancel();
  };

  return (
    <div className={s.root}>

      {/* Workspace identity */}
      <div className={s.identity}>
        <span className={s.idDot} style={{ backgroundColor: workspace.color }} />
        <div className={s.idText}>
          <span className={s.idName}>{workspace.name}</span>
          <span className={s.idPath}>{workspace.path}</span>
        </div>
      </div>

      {/* Sessions */}
      <div className={s.block}>
        <div className={s.blockHead}>
          <Terminal size={11} className={s.blockIcon} />
          <span className={s.blockLabel}>Terminals</span>
          {sessions.length > 0 && <span className={s.count}>{sessions.length}</span>}
        </div>
        {sessions.length === 0
          ? <p className={s.muted}>No open sessions</p>
          : <div className={s.chips}>
              {sessions.map(s2 => (
                <div key={s2.id} className={s.chip}>
                  <span className={s.chipDot} style={{ backgroundColor: s2.color ?? '#6e7681' }} />
                  <span className={s.chipLabel}>{s2.title}</span>
                </div>
              ))}
            </div>
        }
      </div>

      {/* Current task */}
      <div className={s.block}>
        <div className={s.blockHead}>
          <span className={s.blockLabel}>Focus</span>
          {!editing && (
            <button className={s.editBtn} onClick={() => setEditing(true)} title="Edit">
              <Edit2 size={10} />
            </button>
          )}
        </div>
        {editing ? (
          <div className={s.editArea}>
            <textarea
              ref={textareaRef}
              className={s.textarea}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={keydown}
              rows={3}
              placeholder="What are you working on?"
            />
            <div className={s.editRow}>
              <button className={s.saveBtn} onClick={save}><Check size={10} /> Save</button>
              <button className={s.cancelBtn} onClick={cancel}><X size={10} /></button>
              <span className={s.hint}>⌘↵</span>
            </div>
          </div>
        ) : (
          <p
            className={cx(s.focusText, !workspace.currentTask && s.muted)}
            onClick={() => setEditing(true)}
            title="Click to edit"
          >
            {workspace.currentTask || 'Click to set a focus…'}
          </p>
        )}
      </div>

      {/* Conductor */}
      <div className={s.block}>
        <div className={s.blockHead}>
          <Activity size={11} className={s.blockIcon} />
          <span className={s.blockLabel}>Conductor</span>
        </div>
        <ConductorStatus plan={livePlan} />
      </div>

      {/* Task log */}
      {recentLogs.length > 0 && (
        <div className={s.block}>
          <div className={s.blockHead}>
            <Clock size={11} className={s.blockIcon} />
            <span className={s.blockLabel}>Recent</span>
          </div>
          <div className={s.logList}>
            {recentLogs.map(log => {
              const Icon = LOG_STATUS_ICON[log.status];
              return (
                <div key={log.id} className={s.logRow}>
                  <span style={{ color: LOG_STATUS_COLOR[log.status], flexShrink: 0, marginTop: 1, display: 'flex' }}>
                    <Icon size={11} />
                  </span>
                  <div className={s.logBody}>
                    <span className={s.logText}>{log.summary}</span>
                    <span className={s.logTime}>{formatLogTime(log.timestamp)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
};

const s = {
  root: css`
    display: flex; flex-direction: column;
    height: 100%; overflow-y: auto; padding: 0 0 24px;
    background: var(--bg-primary);
    scrollbar-width: thin; scrollbar-color: var(--border-color) transparent;
    &::-webkit-scrollbar { width: 3px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
  `,

  /* Identity */
  identity: css`
    display: flex; align-items: center; gap: 10px;
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--border-color);
  `,
  idDot: css`
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  `,
  idText: css`
    display: flex; flex-direction: column; gap: 2px; min-width: 0;
  `,
  idName: css`
    font-size: 13px; font-weight: 700; color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  `,
  idPath: css`
    font-size: 10px; color: var(--text-tertiary);
    font-family: var(--font-family-mono);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  `,

  /* Blocks */
  block: css`
    display: flex; flex-direction: column; gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-color);
  `,
  blockHead: css`
    display: flex; align-items: center; gap: 6px;
  `,
  blockIcon: css`
    color: var(--text-tertiary); flex-shrink: 0;
  `,
  blockLabel: css`
    font-size: 11px; font-weight: 600; color: var(--text-tertiary);
    flex: 1;
  `,
  count: css`
    font-size: 10px; font-weight: 700; color: var(--color-brand);
    background: color-mix(in srgb, var(--color-brand) 12%, transparent);
    padding: 1px 6px; border-radius: 99px;
  `,
  muted: css`
    font-size: 11px; color: var(--text-tertiary); margin: 0; line-height: 1.5;
  `,

  /* Session chips */
  chips: css`
    display: flex; flex-wrap: wrap; gap: 6px;
  `,
  chip: css`
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 8px; border-radius: 99px;
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    font-size: 11px; font-weight: 600; color: var(--text-secondary);
  `,
  chipDot: css`
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  `,
  chipLabel: css`white-space: nowrap;`,

  /* Focus / task */
  focusText: css`
    font-size: 12px; color: var(--text-secondary); margin: 0;
    line-height: 1.6; cursor: pointer;
    padding: 6px 8px; border-radius: 5px; border: 1px solid transparent;
    transition: border-color 0.15s, background-color 0.15s;
    &:hover { border-color: var(--border-color); background-color: var(--bg-secondary); }
  `,
  editBtn: css`
    background: none; border: none; cursor: pointer;
    color: var(--text-tertiary); display: flex; align-items: center;
    padding: 2px 4px; border-radius: 3px; transition: color 0.15s;
    &:hover { color: var(--text-primary); }
  `,
  editArea: css`display: flex; flex-direction: column; gap: 6px;`,
  textarea: css`
    width: 100%; box-sizing: border-box;
    background: var(--bg-secondary); border: 1px solid var(--color-brand);
    border-radius: 5px; padding: 8px; font-size: 12px;
    color: var(--text-primary); font-family: inherit;
    resize: vertical; outline: none; line-height: 1.6;
    &::placeholder { color: var(--text-tertiary); }
  `,
  editRow: css`
    display: flex; align-items: center; gap: 6px;
  `,
  saveBtn: css`
    display: inline-flex; align-items: center; gap: 4px;
    padding: 4px 10px; background: var(--color-brand); color: #010409;
    border: none; border-radius: 4px; font-size: 11px; font-weight: 700;
    cursor: pointer; transition: opacity 0.15s;
    &:hover { opacity: 0.85; }
  `,
  cancelBtn: css`
    display: inline-flex; align-items: center;
    padding: 4px 7px; background: transparent; color: var(--text-tertiary);
    border: 1px solid var(--border-color); border-radius: 4px;
    font-size: 11px; cursor: pointer; transition: color 0.15s;
    &:hover { color: var(--text-primary); }
  `,
  hint: css`
    font-size: 10px; color: var(--text-tertiary); margin-left: auto;
    font-family: var(--font-family-mono);
  `,

  /* Conductor */
  planWrap: css`display: flex; flex-direction: column; gap: 6px;`,
  planTop: css`display: flex; align-items: flex-start; gap: 8px;`,
  planGoal: css`font-size: 12px; color: var(--text-secondary); flex: 1; line-height: 1.4;`,
  planState: css`font-size: 10px; font-weight: 600; flex-shrink: 0;`,
  bar: css`height: 2px; background: var(--border-color); border-radius: 2px; overflow: hidden;`,
  barFill: css`height: 100%; border-radius: 2px; transition: width 0.5s ease;`,
  planMeta: css`display: flex; flex-wrap: wrap; gap: 8px; font-size: 10px; font-weight: 600;`,
  runningRow: css`display: flex; align-items: center; gap: 6px; padding-top: 4px; border-top: 1px solid var(--border-color);`,
  runDot: css`
    width: 5px; height: 5px; border-radius: 50%; background: #ff9d00; flex-shrink: 0;
    animation: rp 1.4s ease-in-out infinite;
    @keyframes rp { 0%,100%{opacity:1} 50%{opacity:0.3} }
  `,
  runTitle: css`font-size: 11px; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`,
  runTime: css`font-size: 10px; color: var(--text-tertiary); font-family: monospace; flex-shrink: 0;`,

  /* Logs */
  logList: css`display: flex; flex-direction: column; gap: 8px;`,
  logRow: css`display: flex; align-items: flex-start; gap: 7px;`,
  logBody: css`display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;`,
  logText: css`font-size: 11px; color: var(--text-secondary); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;`,
  logTime: css`font-size: 10px; color: var(--text-tertiary);`,
};
