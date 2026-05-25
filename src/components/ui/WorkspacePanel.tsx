import React, { useState, useEffect, useRef } from 'react';
import { css, cx } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import { Edit2, Check, X, Terminal, Activity, Clock, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { Workspace, TaskLog, OrchestratorPlan } from '../../types';
import { orchestratorEngine } from '../../services/orchestratorEngine';

interface WorkspacePanelProps { workspace: Workspace }

const LOG_STATUS_COLOR: Record<TaskLog['status'], string> = {
  'in-progress': '#fbbf24',
  done:          '#34d399',
  blocked:       '#f87171',
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
  if (ms < 60_000)    return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/* ── ConductorStatus ── */
const ConductorStatus: React.FC<{ plan: OrchestratorPlan | null }> = ({ plan }) => {
  if (!plan) return <p className={s.muted}>No plan running</p>;

  const counts = { pending: 0, running: 0, done: 0, failed: 0 };
  plan.tasks.forEach(t => counts[t.status]++);
  const total    = plan.tasks.length;
  const progress = total > 0 ? (counts.done / total) * 100 : 0;
  const color    = plan.status === 'done' ? '#34d399'
                 : plan.status === 'failed' ? '#f87171'
                 : plan.status === 'running' ? 'var(--color-brand)' : '#5f587e';

  return (
    <div className={s.planWrap}>
      <div className={s.planTop}>
        <span className={s.planGoal}>{plan.goal}</span>
        <span className={s.planState} style={{ color }}>{plan.status}</span>
      </div>

      {/* Progress bar */}
      <div className={s.bar}>
        <motion.div
          className={s.barFill}
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        />
      </div>

      <div className={s.planMeta}>
        {counts.running > 0 && <span style={{ color: 'var(--color-brand)' }}>{counts.running} running</span>}
        {counts.done    > 0 && <span style={{ color: '#34d399' }}>{counts.done} done</span>}
        {counts.failed  > 0 && <span style={{ color: '#f87171' }}>{counts.failed} failed</span>}
        {counts.pending > 0 && <span style={{ color: '#5f587e' }}>{counts.pending} pending</span>}
      </div>

      {plan.tasks.filter(t => t.status === 'running').map(t => (
        <div key={t.id} className={s.runRow}>
          <span className={s.runPulse} />
          <span className={s.runTitle}>{t.title}</span>
          {t.startedAt && <span className={s.runTime}>{formatDuration(Date.now() - t.startedAt)}</span>}
        </div>
      ))}
    </div>
  );
};

/* ── WorkspacePanel ── */
export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({ workspace }) => {
  const { taskLogs, terminalSessions, updateWorkspace, showToast } = useDashboard();
  const sessions = terminalSessions.filter(s => s.workspaceId === workspace.id);

  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState(workspace.currentTask);
  const [livePlan, setLivePlan] = useState<OrchestratorPlan | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { return orchestratorEngine.onStateChange(p => setLivePlan({ ...p })); }, []);
  useEffect(() => { if (editing) textareaRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(workspace.currentTask); setEditing(false); }, [workspace.id, workspace.currentTask]);

  const recentLogs = taskLogs
    .filter(l => l.workspaceId === workspace.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  const save   = () => { updateWorkspace(workspace.id, { currentTask: draft }); showToast('Saved', 'success'); setEditing(false); };
  const cancel = () => { setDraft(workspace.currentTask); setEditing(false); };
  const keydown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    if (e.key === 'Escape') cancel();
  };

  const sectionVariants = {
    initial: { opacity: 0, y: 8 },
    animate: (i: number) => ({
      opacity: 1, y: 0,
      transition: { delay: i * 0.06, duration: 0.22 },
    }),
  };

  return (
    <div className={s.root}>

      {/* Workspace identity */}
      <motion.div
        className={s.identity}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div
          className={s.identityAvatar}
          style={{ backgroundColor: workspace.color + '1a', borderColor: workspace.color + '30' }}
        >
          <span className={s.identityDot} style={{ backgroundColor: workspace.color }} />
        </div>
        <div className={s.identityText}>
          <span className={s.identityName}>{workspace.name}</span>
          <span className={s.identityPath}>{workspace.path}</span>
        </div>
      </motion.div>

      {/* Terminals */}
      <motion.div
        className={s.section}
        variants={sectionVariants}
        initial="initial"
        animate="animate"
        custom={0}
      >
        <div className={s.sectionHead}>
          <Terminal size={12} className={s.sectionIcon} />
          <span className={s.sectionLabel}>Terminals</span>
          {sessions.length > 0 && <span className={s.badge}>{sessions.length}</span>}
        </div>
        {sessions.length === 0
          ? <p className={s.muted}>No open sessions</p>
          : <div className={s.chips}>
              {sessions.map(sess => (
                <motion.div
                  key={sess.id}
                  className={s.chip}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <span className={s.chipDot} style={{ backgroundColor: sess.color ?? '#5f587e' }} />
                  <span className={s.chipLabel}>{sess.title}</span>
                </motion.div>
              ))}
            </div>
        }
      </motion.div>

      {/* Focus / current task */}
      <motion.div
        className={s.section}
        variants={sectionVariants}
        initial="initial"
        animate="animate"
        custom={1}
      >
        <div className={s.sectionHead}>
          <span className={s.sectionLabel}>Focus</span>
          {!editing && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className={s.editBtn}
              onClick={() => setEditing(true)}
              title="Edit"
            >
              <Edit2 size={10} />
            </motion.button>
          )}
        </div>

        <AnimatePresence mode="wait">
          {editing ? (
            <motion.div
              key="edit"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className={s.editArea}
            >
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
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                  className={s.saveBtn}
                  onClick={save}
                >
                  <Check size={10} /> Save
                </motion.button>
                <button className={s.cancelBtn} onClick={cancel}><X size={10} /></button>
                <span className={s.hint}>⌘↵</span>
              </div>
            </motion.div>
          ) : (
            <motion.p
              key="display"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className={cx(s.focusText, !workspace.currentTask && s.focusPlaceholder)}
              onClick={() => setEditing(true)}
              title="Click to edit"
            >
              {workspace.currentTask || 'Click to set a focus…'}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Conductor */}
      <motion.div
        className={s.section}
        variants={sectionVariants}
        initial="initial"
        animate="animate"
        custom={2}
      >
        <div className={s.sectionHead}>
          <Activity size={12} className={s.sectionIcon} />
          <span className={s.sectionLabel}>Conductor</span>
        </div>
        <ConductorStatus plan={livePlan} />
      </motion.div>

      {/* Recent logs */}
      <AnimatePresence>
        {recentLogs.length > 0 && (
          <motion.div
            className={s.section}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.18, duration: 0.22 }}
          >
            <div className={s.sectionHead}>
              <Clock size={12} className={s.sectionIcon} />
              <span className={s.sectionLabel}>Recent</span>
            </div>
            <div className={s.logList}>
              {recentLogs.map((log, i) => {
                const Icon = LOG_STATUS_ICON[log.status];
                return (
                  <motion.div
                    key={log.id}
                    className={s.logRow}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.18 }}
                  >
                    <span style={{ color: LOG_STATUS_COLOR[log.status], display: 'flex', flexShrink: 0, marginTop: 1 }}>
                      <Icon size={11} />
                    </span>
                    <div className={s.logBody}>
                      <span className={s.logText}>{log.summary}</span>
                      <span className={s.logTime}>{formatLogTime(log.timestamp)}</span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const s = {
  root: css`
    display: flex; flex-direction: column;
    height: 100%; overflow-y: auto;
    background: var(--bg-primary);
    padding-bottom: 24px;
    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
    &::-webkit-scrollbar { width: 3px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 99px; }
  `,

  /* Identity */
  identity: css`
    display: flex; align-items: center; gap: 12px;
    padding: 16px 16px 14px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
  `,
  identityAvatar: css`
    width: 34px; height: 34px;
    border-radius: 9px;
    border: 1px solid;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  `,
  identityDot: css`
    width: 10px; height: 10px;
    border-radius: 50%;
  `,
  identityText: css`
    display: flex; flex-direction: column; gap: 3px; min-width: 0;
  `,
  identityName: css`
    font-size: 13px; font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  `,
  identityPath: css`
    font-size: 10px; color: var(--text-tertiary);
    font-family: var(--font-family-mono);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  `,

  /* Sections */
  section: css`
    display: flex; flex-direction: column; gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-color);
  `,
  sectionHead: css`
    display: flex; align-items: center; gap: 7px;
  `,
  sectionIcon: css`
    color: var(--text-tertiary); flex-shrink: 0;
  `,
  sectionLabel: css`
    font-size: 11px; font-weight: 600;
    color: var(--text-tertiary);
    flex: 1;
  `,
  badge: css`
    font-size: 10px; font-weight: 700;
    color: var(--color-brand);
    background: rgba(var(--color-brand-rgb), 0.12);
    padding: 1px 6px; border-radius: 99px;
  `,
  muted: css`
    font-size: 11px; color: var(--text-tertiary); margin: 0;
  `,

  /* Chips */
  chips: css`
    display: flex; flex-wrap: wrap; gap: 6px;
  `,
  chip: css`
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 9px; border-radius: 99px;
    background: var(--bg-hover); border: 1px solid var(--border-color);
    font-size: 11px; font-weight: 600; color: var(--text-secondary);
  `,
  chipDot: css`
    width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
  `,
  chipLabel: css`white-space: nowrap;`,

  /* Focus */
  focusText: css`
    font-size: 12px; color: var(--text-secondary); margin: 0;
    line-height: 1.6; cursor: pointer;
    padding: 7px 9px;
    border-radius: 8px; border: 1px solid transparent;
    transition: border-color 0.15s, background 0.15s;
    &:hover { border-color: var(--border-color); background: var(--bg-hover); }
  `,
  focusPlaceholder: css`
    color: var(--text-tertiary); font-style: italic;
  `,
  editBtn: css`
    background: none; border: none; cursor: pointer;
    color: var(--text-tertiary);
    display: flex; align-items: center;
    padding: 3px 5px; border-radius: 5px;
    transition: color 0.12s, background 0.12s;
    &:hover { color: var(--text-primary); background: var(--bg-hover); }
  `,
  editArea: css`display: flex; flex-direction: column; gap: 7px;`,
  textarea: css`
    width: 100%; box-sizing: border-box;
    background: var(--bg-canvas);
    border: 1px solid var(--border-color-focus);
    border-radius: 8px; padding: 9px 10px;
    font-size: 12px;
    color: var(--text-primary); font-family: inherit;
    resize: vertical; outline: none; line-height: 1.6;
    &::placeholder { color: var(--text-tertiary); }
  `,
  editRow: css`
    display: flex; align-items: center; gap: 7px;
  `,
  saveBtn: css`
    display: inline-flex; align-items: center; gap: 4px;
    padding: 5px 11px;
    background: var(--gradient-brand);
    color: #fff;
    border: none; border-radius: 7px;
    font-size: 11px; font-weight: 700;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(123, 104, 238, 0.25);
    &:hover { filter: brightness(1.08); }
  `,
  cancelBtn: css`
    display: inline-flex; align-items: center;
    padding: 5px 8px;
    background: transparent; color: var(--text-tertiary);
    border: 1px solid var(--border-color); border-radius: 6px;
    font-size: 11px; cursor: pointer;
    transition: color 0.12s;
    &:hover { color: var(--text-primary); }
  `,
  hint: css`
    font-size: 10px; color: var(--text-tertiary); margin-left: auto;
    font-family: var(--font-family-mono);
  `,

  /* Conductor plan */
  planWrap: css`display: flex; flex-direction: column; gap: 7px;`,
  planTop:  css`display: flex; align-items: flex-start; gap: 8px;`,
  planGoal: css`font-size: 12px; color: var(--text-secondary); flex: 1; line-height: 1.4;`,
  planState: css`font-size: 10px; font-weight: 700; flex-shrink: 0; text-transform: capitalize;`,
  bar: css`
    height: 3px; background: var(--bg-hover);
    border-radius: 99px; overflow: hidden;
  `,
  barFill: css`height: 100%; border-radius: 99px;`,
  planMeta: css`display: flex; flex-wrap: wrap; gap: 8px; font-size: 10px; font-weight: 600;`,
  runRow: css`
    display: flex; align-items: center; gap: 7px;
    padding-top: 6px;
    border-top: 1px solid var(--border-color);
  `,
  runPulse: css`
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--color-brand); flex-shrink: 0;
    animation: rp 1.5s ease-in-out infinite;
    @keyframes rp { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.7)} }
  `,
  runTitle: css`
    font-size: 11px; color: var(--text-secondary); flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  runTime: css`
    font-size: 10px; color: var(--text-tertiary);
    font-family: var(--font-family-mono); flex-shrink: 0;
  `,

  /* Logs */
  logList: css`display: flex; flex-direction: column; gap: 9px;`,
  logRow:  css`display: flex; align-items: flex-start; gap: 8px;`,
  logBody: css`display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;`,
  logText: css`
    font-size: 11px; color: var(--text-secondary); line-height: 1.45;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  `,
  logTime: css`font-size: 10px; color: var(--text-tertiary);`,
};
