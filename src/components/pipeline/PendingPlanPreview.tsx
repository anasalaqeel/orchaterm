/*
 * PendingPlanPreview.tsx
 *
 * Card shown at the top of the Pipeline Builder when the chat just generated a
 * plan. Lists tasks with their (resolved) dependencies, an execution-mode
 * toggle, and Run / Discard buttons.
 */
import React from 'react';
import { css, cx } from '@emotion/css';
import { SlidersHorizontal, ListOrdered, Zap } from 'lucide-react';
import type { OrchestratorTask } from '../../types';

interface PendingPlanPreviewProps {
  goal: string;
  tasks: OrchestratorTask[];
  executionMode: 'sequential' | 'parallel';
  onExecutionModeChange: (mode: 'sequential' | 'parallel') => void;
  onRun: () => void;
  onDiscard: () => void;
}

export const PendingPlanPreview: React.FC<PendingPlanPreviewProps> = ({
  goal,
  tasks,
  executionMode,
  onExecutionModeChange,
  onRun,
  onDiscard,
}) => {
  return (
    <div className={s.preview}>
      <div className={s.header}>
        <SlidersHorizontal size={12} />
        <span className={s.headerLabel}>Proposed Pipeline</span>
        <span className={s.headerGoal} title={goal}>{goal}</span>
      </div>

      <div className={s.taskList}>
        {tasks.map((task, i) => {
          const depNames = executionMode === 'sequential'
            ? (i > 0 ? [tasks[i - 1].title] : [])
            : task.dependsOn
                .map(id => tasks.find(t => t.id === id)?.title)
                .filter((t): t is string => Boolean(t));
          return (
            <div key={task.id} className={s.task}>
              <span className={s.taskNum}>{i + 1}</span>
              <div className={s.taskBody}>
                <div className={s.taskTitle}>{task.title}</div>
                <div className={s.taskMeta}>
                  <span className={s.taskAgent}>{task.assignedSessionTitle}</span>
                  {depNames.length > 0 && (
                    <span className={s.taskDeps}>after: {depNames.join(', ')}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className={s.modeBar}>
        <span className={s.modeLabel}>Execution Mode</span>
        <div className={s.modeToggle}>
          <button
            className={cx(s.modeBtn, executionMode === 'sequential' && s.modeBtnActive)}
            onClick={() => onExecutionModeChange('sequential')}
            title="Run steps one after another (Step 1 → Step 2)"
          >
            <ListOrdered size={12} />
            Sequential
          </button>
          <button
            className={cx(s.modeBtn, executionMode === 'parallel' && s.modeBtnActive)}
            onClick={() => onExecutionModeChange('parallel')}
            title="Run all steps concurrently at the same time"
          >
            <Zap size={12} />
            Parallel
          </button>
        </div>
      </div>

      <div className={s.actions}>
        <button className={s.runBtn} onClick={onRun} title="Start running this plan">
          ▶ Run Plan
        </button>
        <button className={s.discardBtn} onClick={onDiscard}>✕ Discard</button>
      </div>
    </div>
  );
};

const s = {
  preview: css`
    border: 1px solid rgba(var(--color-info-rgb), 0.2);
    border-radius: 8px; overflow: hidden;
    background: rgba(var(--color-info-rgb), 0.04);
  `,
  header: css`
    display: flex; align-items: center; gap: 7px;
    padding: 9px 12px;
    background: rgba(var(--color-info-rgb), 0.07);
    border-bottom: 1px solid rgba(var(--color-info-rgb), 0.15);
    font-size: 11px; font-weight: 600; color: var(--color-info);
  `,
  headerLabel: css`flex-shrink: 0;`,
  headerGoal: css`
    flex: 1; min-width: 0;
    font-weight: 400; color: var(--text-secondary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  taskList: css`
    display: flex; flex-direction: column; gap: 1px;
    padding: 6px 0;
  `,
  task: css`
    display: flex; align-items: flex-start; gap: 10px;
    padding: 7px 12px;
    &:hover { background: var(--bg-input); }
  `,
  taskNum: css`
    font-size: 10px; font-weight: 700; color: var(--text-tertiary);
    min-width: 16px; text-align: right; padding-top: 1px; flex-shrink: 0;
  `,
  taskBody: css`display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;`,
  taskTitle: css`font-size: 12px; color: var(--text-primary); font-weight: 500;`,
  taskMeta: css`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`,
  taskAgent: css`
    font-size: 10px; color: var(--color-brand); font-weight: 600;
    background: rgba(var(--color-brand-rgb), 0.1);
    padding: 1px 6px; border-radius: 99px;
  `,
  taskDeps: css`font-size: 10px; color: var(--text-tertiary);`,

  modeBar: css`
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px; margin: 6px 10px 0;
    background: var(--bg-canvas);
    border: 1px solid rgba(var(--color-info-rgb), 0.15);
    border-radius: 8px;
  `,
  modeLabel: css`font-size: 11px; font-weight: 600; color: var(--text-secondary);`,
  modeToggle: css`
    display: flex; align-items: center; gap: 2px;
    background: var(--bg-input); border: 1px solid var(--border-color);
    border-radius: 6px; padding: 2px;
  `,
  modeBtn: css`
    display: flex; align-items: center; gap: 4px;
    border: none; background: transparent; color: var(--text-tertiary);
    font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 4px;
    cursor: pointer; transition: all 0.15s ease;
    &:hover { color: var(--text-primary); }
  `,
  modeBtnActive: css`
    background: var(--color-brand); color: #fff;
    box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    &:hover { color: #fff; }
  `,

  actions: css`
    display: flex; gap: 8px; padding: 10px 12px;
    border-top: 1px solid rgba(var(--color-info-rgb), 0.12);
    background: var(--bg-canvas);
  `,
  runBtn: css`
    flex: 1; padding: 7px 12px; border-radius: 6px; border: none;
    background: var(--color-info); color: var(--bg-secondary);
    font-size: 12px; font-weight: 700;
    cursor: pointer; transition: all 150ms ease;
    &:hover:not(:disabled) { filter: brightness(1.1); }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  `,
  discardBtn: css`
    padding: 7px 14px; border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent; color: var(--text-tertiary);
    font-size: 12px;
    cursor: pointer; transition: all 150ms ease;
    &:hover { border-color: var(--color-error); color: var(--color-error); }
  `,
};
