/*
 * PipelineHistory.tsx
 *
 * Lists past plans (filtered by the active workspace) with status, goal,
 * task count, and relative time. Expandable rows show task breakdown.
 * A "Reuse as Template" button converts a past plan into a reusable template.
 */
import React, { useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import { ChevronDown, ChevronUp, RotateCcw, BookmarkPlus } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import type { OrchestratorPlan, PipelineTemplate } from '../../types';
import { formatRelative } from '../../utils';
import { PLAN_STATUS_COLORS, PLAN_STATUS_ICONS, ExecutionModeBadge, TaskRow } from './index';

interface PipelineHistoryProps {
  workspaceId: string;
  /** Re-run a past plan: fresh task IDs, same goal + deps. */
  onRerunPlan?: (plan: OrchestratorPlan) => void;
}



type FilterKey = 'all' | 'running' | 'done' | 'failed' | 'stopped';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'done',    label: 'Done' },
  { key: 'failed',  label: 'Failed' },
  { key: 'stopped', label: 'Stopped' },
];

export const PipelineHistory: React.FC<PipelineHistoryProps> = ({ workspaceId, onRerunPlan }) => {
  const { plans, addPipelineTemplate, showToast } = useDashboard();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    return plans
      .filter(p => p.workspaceId === workspaceId)
      .filter(p => filter === 'all' || p.status === filter)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [plans, workspaceId, filter]);

  const counts = useMemo(() => {
    const workspacePlans = plans.filter(p => p.workspaceId === workspaceId);
    return {
      all:     workspacePlans.length,
      running: workspacePlans.filter(p => p.status === 'running').length,
      done:    workspacePlans.filter(p => p.status === 'done').length,
      failed:  workspacePlans.filter(p => p.status === 'failed').length,
      stopped: workspacePlans.filter(p => p.status === 'stopped').length,
    };
  }, [plans, workspaceId]);

  const reuseAsTemplate = (plan: OrchestratorPlan) => {
    const tasks: PipelineTemplate['tasks'] = plan.tasks.map((t, i) => ({
      id: crypto.randomUUID(),
      title: t.title,
      description: t.description,
      agentHint: t.assignedSessionTitle,
      dependsOnIndices: plan.tasks
        .map((other, j) => (other.id !== t.id && t.dependsOn.includes(other.id) ? j : -1))
        .filter(j => j >= 0)
        .concat(i > 0 && t.dependsOn.length === 0 ? [i - 1] : []),
    }));

    // Prefer the mode actually recorded on the plan; only fall back to a
    // heuristic for plans persisted before executionMode was tracked.
    const executionMode = plan.executionMode ?? (
      plan.tasks.every((t, i) =>
        i === 0 || plan.tasks.slice(0, i).some(p => t.dependsOn.includes(p.id))
      ) ? 'sequential' : 'parallel'
    );

    addPipelineTemplate({
      title: plan.goal.slice(0, 80) || 'Reused pipeline',
      description: `Reused from a past plan (${new Date(plan.createdAt).toLocaleString()}).`,
      executionMode,
      tags: ['reused'],
      tasks,
    }).then(() => showToast('Saved as template — find it in the Templates tab', 'success'));
  };

  return (
    <div className={s.root}>
      <div className={s.filters}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={cx(s.chip, filter === f.key && s.chipActive)}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className={s.chipCount}>{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <span className={s.emptyIcon}>∅</span>
          <p className={s.emptyTitle}>No past pipelines here yet.</p>
          <p className={s.emptyHint}>
            When you run a pipeline it will appear here with its task breakdown and final outputs.
          </p>
        </div>
      ) : (
        <div className={s.list}>
          {filtered.map(plan => {
            const isOpen = !!expanded[plan.id];
            const done = plan.tasks.filter(t => t.status === 'done').length;
            const color = PLAN_STATUS_COLORS[plan.status];
            return (
              <div key={plan.id} className={cx(s.card, isOpen && s.cardOpen)}>
                <button className={s.row} onClick={() => setExpanded(p => ({ ...p, [plan.id]: !p[plan.id] }))}>
                  <span className={s.statusIcon} style={{ color }}>{PLAN_STATUS_ICONS[plan.status]}</span>
                  <span className={s.statusBadge} style={{ color, backgroundColor: color + '1a', borderColor: color + '44' }}>
                    {plan.status.toUpperCase()}
                  </span>
                  {plan.executionMode && <ExecutionModeBadge mode={plan.executionMode} short />}
                  <span className={s.goal} title={plan.goal}>{plan.goal}</span>
                  <span className={s.taskCount}>{done}/{plan.tasks.length} done</span>
                  <span className={s.timestamp}>{formatRelative(plan.createdAt)}</span>
                  {isOpen
                    ? <ChevronUp size={12} className={s.chevron} />
                    : <ChevronDown size={12} className={s.chevron} />}
                </button>

                {isOpen && (
                  <div className={s.body}>
                    <div className={s.taskList}>
                      {plan.tasks.map((task, i) => (
                        <TaskRow
                          key={task.id}
                          index={i + 1}
                          title={task.title}
                          agentHint={task.assignedSessionTitle}
                          status={task.status}
                          filesCount={task.status === 'done' ? task.output?.filesModified.length : undefined}
                        />
                      ))}
                    </div>

                    {plan.tasks.some(t => t.output?.summary) && (
                      <div className={s.summaries}>
                        {plan.tasks
                          .filter(t => t.output?.summary)
                          .map(t => (
                            <div key={t.id} className={s.summaryItem}>
                              <span className={s.summaryLabel}>{t.title}</span>
                              <span className={s.summaryText}>{t.output!.summary}</span>
                            </div>
                          ))}
                      </div>
                    )}

                    <div className={s.rowActions}>
                      {onRerunPlan && (
                        <button
                          className={cx(s.reuseBtn, s.rerunBtn)}
                          onClick={() => onRerunPlan(plan)}
                          title="Re-run this plan now (fresh task IDs, same goal + deps)"
                        >
                          <RotateCcw size={11} /> Re-run
                        </button>
                      )}
                      <button
                        className={s.reuseBtn}
                        onClick={() => reuseAsTemplate(plan)}
                        title="Save this plan as a reusable template"
                      >
                        <BookmarkPlus size={11} /> Reuse as Template
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
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
  filters: css`
    display: flex; gap: 4px; flex-wrap: wrap;
    flex-shrink: 0;
  `,
  chip: css`
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 10px;
    font-size: 11px; font-weight: 600;
    color: var(--text-tertiary);
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover { color: var(--text-primary); border-color: var(--border-color-hover); }
  `,
  chipActive: css`
    background: var(--color-brand);
    color: #fff;
    border-color: var(--color-brand);
  `,
  chipCount: css`
    font-size: 9px;
    background: rgba(255,255,255,0.08);
    padding: 0 5px; border-radius: 99px;
    color: inherit;
    opacity: 0.85;
  `,

  list: css`
    display: flex; flex-direction: column; gap: 4px;
  `,
  card: css`
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
    overflow: hidden;
    transition: border-color 0.15s;
    &:hover { border-color: var(--border-color-hover); }
  `,
  cardOpen: css`
    border-color: var(--color-brand);
  `,
  row: css`
    display: flex; align-items: center; gap: 8px;
    width: 100%;
    padding: 9px 10px;
    background: transparent;
    border: none; cursor: pointer;
    text-align: left;
    color: inherit;
    transition: background 0.15s;
    &:hover { background: var(--bg-hover); }
  `,
  statusIcon: css`
    font-size: 13px; font-weight: 700;
    width: 14px; text-align: center; flex-shrink: 0;
  `,
  statusBadge: css`
    font-size: 9px; font-weight: 700;
    padding: 1px 6px; border-radius: 99px;
    border: 1px solid; letter-spacing: 0.04em;
    flex-shrink: 0;
  `,
  modeBadge: css`
    display: inline-flex; align-items: center; gap: 3px;
    font-size: 9px; font-weight: 700;
    padding: 1px 6px; border-radius: 99px;
    color: var(--color-info);
    background: rgba(var(--color-info-rgb), 0.12);
    border: 1px solid rgba(var(--color-info-rgb), 0.3);
    flex-shrink: 0;
  `,
  goal: css`
    flex: 1; min-width: 0;
    font-size: 12px; color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  taskCount: css`
    font-size: 10px; color: var(--text-secondary);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  `,
  timestamp: css`
    font-size: 10px; color: var(--text-tertiary);
    flex-shrink: 0; min-width: 50px; text-align: right;
  `,
  chevron: css`
    color: var(--text-tertiary); flex-shrink: 0;
  `,

  body: css`
    padding: 10px;
    border-top: 1px dashed var(--border-color);
    background: var(--bg-canvas);
    display: flex; flex-direction: column; gap: 10px;
  `,
  taskList: css`
    display: flex; flex-direction: column; gap: 2px;
  `,
  summaries: css`
    display: flex; flex-direction: column; gap: 5px;
    padding-top: 6px; border-top: 1px dashed var(--border-color);
  `,
  summaryItem: css`
    display: flex; flex-direction: column; gap: 1px;
  `,
  summaryLabel: css`
    font-size: 10px; font-weight: 700; color: var(--text-tertiary);
  `,
  summaryText: css`
    font-size: 11px; color: var(--text-primary); line-height: 1.4;
  `,

  rowActions: css`
    display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap;
  `,
  reuseBtn: css`
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-size: 11px; font-weight: 600;
    padding: 5px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover { color: var(--color-brand); border-color: var(--color-brand); background: rgba(var(--color-brand-rgb), 0.08); }
  `,
  rerunBtn: css`
    color: var(--color-brand);
    border-color: rgba(var(--color-brand-rgb), 0.4);
    background: rgba(var(--color-brand-rgb), 0.06);
    &:hover { background: var(--color-brand); color: #fff; border-color: var(--color-brand); }
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
