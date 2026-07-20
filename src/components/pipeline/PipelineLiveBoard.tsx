/*
 * PipelineLiveBoard.tsx
 *
 * Live execution view: header (goal + controls), animated progress bar,
 * full dependency graph, and rich task cards sorted by execution order.
 */
import React, { useEffect, useState } from 'react';
import { css, cx } from '@emotion/css';
import { RotateCcw } from 'lucide-react';
import { orchestratorEngine } from '../../services/orchestratorEngine';
import type { OrchestratorPlan, OrchestratorTaskStatus, TerminalSession } from '../../types';
import { DependencyGraph } from './DependencyGraph';
import { TaskCard } from './TaskCard';
import { PLAN_STATUS_COLORS, PLAN_STATUS_ICONS, ExecutionModeBadge } from './index';

interface PipelineLiveBoardProps {
  plan: OrchestratorPlan | null;
  onDismiss: () => void;
  /** Re-run the current plan: fresh task IDs, same goal + deps. */
  onRerun: (plan: OrchestratorPlan) => void;
  /** Terminal sessions in this space — used to colour agent pills. */
  sessions: TerminalSession[];
}



export const PipelineLiveBoard: React.FC<PipelineLiveBoardProps> = ({ plan, onDismiss, onRerun, sessions }) => {
  // Tick once a second while a task is running so elapsed times update.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!plan || plan.status !== 'running') return;
    const i = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(i);
  }, [plan?.status]);

  if (!plan || plan.tasks.length === 0) {
    return (
      <div className={s.empty}>
        <span className={s.emptyIcon}>∅</span>
        <p className={s.emptyTitle}>No active pipeline</p>
        <p className={s.emptyHint}>
          Build a pipeline in the Builder tab, or describe a goal in Chat — when a plan runs it will appear here live.
        </p>
      </div>
    );
  }

  const status = plan.status;
  const statusColor = PLAN_STATUS_COLORS[status] ?? PLAN_STATUS_COLORS.unknown;
  const statusIcon = PLAN_STATUS_ICONS[status];

  const total = plan.tasks.length;
  const done = plan.tasks.filter(t => t.status === 'done').length;
  const failed = plan.tasks.filter(t => t.status === 'failed').length;
  const running = plan.tasks.filter(t => t.status === 'running').length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  // Order: running first, then by start time desc, then pending, then completed/failed.
  const ordered = [...plan.tasks].sort((a, b) => {
    const orderOf = (s: OrchestratorTaskStatus) => s === 'running' ? 0 : s === 'pending' ? 1 : 2;
    if (orderOf(a.status) !== orderOf(b.status)) return orderOf(a.status) - orderOf(b.status);
    return (a.startedAt ?? 0) - (b.startedAt ?? 0);
  });

  const taskById = new Map(plan.tasks.map(t => [t.id, t]));
  // 1-based position of each task in the plan — NOT the position within any
  // single task's dependsOn list, which is almost always length 1 and would
  // otherwise make every dependency read as "#1" regardless of which task it is.
  const taskIndexById = new Map(plan.tasks.map((t, i) => [t.id, i + 1]));
  const resolveDependency = (id: string) => {
    const t = taskById.get(id);
    const idx = taskIndexById.get(id);
    return t && idx !== undefined ? { title: t.title, index: idx } : undefined;
  };
  const sessionColor = (sid: string) => sessions.find(s => s.id === sid)?.color ?? null;

  return (
    <div className={s.root}>
      <div className={s.header}>
        <span className={s.statusIcon} style={{ color: statusColor }}>{statusIcon}</span>
        <div className={s.headerBody}>
          <div className={s.goalRow}>
            <span className={s.goal} title={plan.goal}>{plan.goal}</span>
          </div>
          <div className={s.metaRow}>
            <span className={s.statusBadge} style={{ color: statusColor, backgroundColor: statusColor + '1a', borderColor: statusColor + '44' }}>
              {status.toUpperCase()}
            </span>
            {plan.executionMode && <ExecutionModeBadge mode={plan.executionMode} />}
            <span className={s.metaItem}>{total} task{total !== 1 ? 's' : ''}</span>
            {running > 0 && <span className={s.metaItem} style={{ color: 'var(--color-brand)' }}>{running} running</span>}
            {done   > 0 && <span className={s.metaItem} style={{ color: 'var(--color-success)' }}>{done} done</span>}
            {failed > 0 && <span className={s.metaItem} style={{ color: 'var(--color-error)' }}>{failed} failed</span>}
          </div>
        </div>

        <div className={s.controls}>
          {status === 'running' && (
            <button
              title="Pause orchestration"
              onClick={() => orchestratorEngine.pause()}
              className={cx(s.controlBtn, s.controlWarn)}
            >⏸ Pause</button>
          )}
          {status === 'paused' && (
            <button
              title="Resume orchestration"
              onClick={() => orchestratorEngine.resume()}
              className={cx(s.controlBtn, s.controlBrand)}
            >▶ Resume</button>
          )}
          {(status === 'running' || status === 'paused') && (
            <button
              title="Stop orchestration"
              onClick={() => orchestratorEngine.stop()}
              className={cx(s.controlBtn, s.controlError)}
            >■ Stop</button>
          )}
          {(status === 'done' || status === 'failed' || status === 'stopped') && (
            <>
              <button
                title="Re-run this pipeline with fresh task IDs (same goal + deps)"
                onClick={() => onRerun(plan)}
                className={cx(s.controlBtn, s.controlBrand)}
              >
                <RotateCcw size={11} />
                Re-run
              </button>
              <button title="Dismiss" onClick={onDismiss} className={s.controlBtn}>✕ Dismiss</button>
            </>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className={s.progressTrack}>
        <div
          className={cx(s.progressFill, status === 'running' && s.progressFillStripped)}
          style={{
            width: `${pct}%`,
            background:
              status === 'failed'  ? 'var(--color-error)'   :
              status === 'stopped' ? 'var(--text-tertiary)' :
              status === 'done'    ? 'var(--color-success)' :
              'var(--color-brand)',
          }}
        />
        <span className={s.progressLabel}>{done} / {total} · {pct}%</span>
      </div>

      {/* Dependency graph */}
      <div className={s.graphSection}>
        <DependencyGraph
          tasks={plan.tasks}
          title={<span>Dependency graph · {total} task{total !== 1 ? 's' : ''}</span>}
        />
      </div>

      {/* Task cards */}
      <div className={s.taskList}>
        {ordered.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            index={taskIndexById.get(task.id) ?? 0}
            resolveDependency={resolveDependency}
            agentColor={sessionColor(task.assignedSessionId) ?? undefined}
            defaultExpanded={task.status === 'failed' || (task.status === 'done' && !!task.output)}
          />
        ))}
      </div>
    </div>
  );
};

const s = {
  root: css`
    flex: 1; min-height: 0; overflow-y: auto;
    display: flex; flex-direction: column; gap: 10px;
    padding: 12px;
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
  `,

  header: css`
    display: flex; align-items: flex-start; gap: 8px;
    padding: 10px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
  `,
  statusIcon: css`
    font-size: 16px; font-weight: 700;
    width: 20px; flex-shrink: 0; text-align: center;
    padding-top: 1px;
  `,
  headerBody: css`
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; gap: 5px;
  `,
  goalRow: css`
    display: flex; align-items: center; gap: 8px;
  `,
  goal: css`
    font-size: 12px; font-weight: 600; color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
  `,
  metaRow: css`
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  `,
  statusBadge: css`
    font-size: 9px; font-weight: 700;
    padding: 1px 6px; border-radius: 99px;
    border: 1px solid; letter-spacing: 0.04em;
  `,
  metaItem: css`font-size: 10px; color: var(--text-tertiary);`,
  controls: css`
    display: flex; flex-direction: column; gap: 4px;
    flex-shrink: 0;
  `,
  controlBtn: css`
    display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    border-radius: 5px;
    padding: 4px 10px;
    font-size: 10px; font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    &:hover { color: var(--text-primary); border-color: var(--text-secondary); }
  `,
  controlBrand: css`
    color: var(--color-brand); border-color: var(--color-brand);
    &:hover { background: rgba(var(--color-brand-rgb), 0.12); }
  `,
  controlWarn: css`
    color: var(--color-warning); border-color: var(--color-warning);
    &:hover { background: rgba(var(--color-warning-rgb), 0.12); }
  `,
  controlError: css`
    color: var(--color-error); border-color: var(--color-error);
    &:hover { background: rgba(var(--color-error-rgb), 0.12); }
  `,

  progressTrack: css`
    position: relative;
    height: 14px;
    background: var(--bg-tertiary);
    border-radius: 6px;
    border: 1px solid var(--border-color);
    overflow: hidden;
  `,
  progressFill: css`
    position: absolute; top: 0; left: 0; bottom: 0;
    transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 5px 0 0 5px;
  `,
  progressFillStripped: css`
    background-image:
      linear-gradient(45deg,
        rgba(255,255,255,0.18) 25%, transparent 25%,
        transparent 50%, rgba(255,255,255,0.18) 50%,
        rgba(255,255,255,0.18) 75%, transparent 75%, transparent);
    background-size: 16px 16px;
    animation: progress-stripes 0.9s linear infinite;
    @keyframes progress-stripes { from { background-position: 0 0; } to { background-position: 16px 0; } }
  `,
  progressLabel: css`
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700; color: var(--text-primary);
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  `,

  graphSection: css`
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 8px 10px;
  `,

  taskList: css`
    display: flex; flex-direction: column; gap: 6px;
  `,

  empty: css`
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 40px 24px; gap: 8px; text-align: center;
  `,
  emptyIcon: css`
    font-size: 28px; color: var(--border-color-hover);
  `,
  emptyTitle: css`
    font-size: 13px; font-weight: 700; color: var(--text-tertiary); margin: 0;
  `,
  emptyHint: css`
    font-size: 11px; color: var(--text-tertiary); line-height: 1.5; max-width: 260px; opacity: 0.8;
  `,
};
