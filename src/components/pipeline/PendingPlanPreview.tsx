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
  /** Available sessions for per-task agent assignment. */
  sessions: Array<{ id: string; title: string }>;
  /** Reassign a task's target terminal (fixes tasks the planner couldn't match). */
  onSessionChange: (taskId: string, sessionId: string) => void;
  onRun: () => void;
  onDiscard: () => void;
}

export const PendingPlanPreview: React.FC<PendingPlanPreviewProps> = ({
  goal,
  tasks,
  executionMode,
  onExecutionModeChange,
  sessions,
  onSessionChange,
  onRun,
  onDiscard,
}) => {
  // When the plan generator declared a dependency graph, that graph is what
  // runs — the execution-mode toggle only applies when nothing declared deps,
  // so don't show a control that would do nothing.
  const declaresDeps = tasks.some((t) => t.dependsOn.length > 0);

  return (
    <div className={s.preview}>
      <div className={s.header}>
        <SlidersHorizontal size={12} />
        <span className={s.headerLabel}>Proposed Pipeline</span>
        <span className={s.headerGoal} title={goal}>
          {goal}
        </span>
      </div>

      <div className={s.taskList}>
        {tasks.map((task, i) => {
          const depNames = declaresDeps
            ? task.dependsOn
                .map((id) => tasks.find((t) => t.id === id)?.title)
                .filter((t): t is string => Boolean(t))
            : executionMode === 'sequential' && i > 0
              ? [tasks[i - 1].title]
              : [];
          const assigned = sessions.find((sess) => sess.id === task.assignedSessionId);
          return (
            <div key={task.id} className={s.task}>
              <span className={s.taskNum}>{i + 1}</span>
              <div className={s.taskBody}>
                <div className={s.taskTitle}>{task.title}</div>
                <div className={s.taskMeta}>
                  {task.askUserQuestion ? (
                    // Gates ask you, not a terminal — no session assignment needed.
                    <span className={s.taskGate} title={task.askUserQuestion}>
                      ❓ user gate
                    </span>
                  ) : (
                    <select
                      className={cx(s.taskAgent, !assigned && s.taskAgentMissing)}
                      value={task.assignedSessionId}
                      onChange={(e) => onSessionChange(task.id, e.target.value)}
                      title="Terminal this task runs in"
                    >
                      {!assigned && <option value="">(assign tab)</option>}
                      {sessions.map((sess) => (
                        <option key={sess.id} value={sess.id}>
                          {sess.title}
                        </option>
                      ))}
                    </select>
                  )}
                  {depNames.length > 0 && (
                    <span className={s.taskDeps}>after: {depNames.join(', ')}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!declaresDeps && (
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
      )}

      <div className={s.actions}>
        <button className={s.runBtn} onClick={onRun} title="Start running this plan">
          ▶ Run Plan
        </button>
        <button className={s.discardBtn} onClick={onDiscard}>
          ✕ Discard
        </button>
      </div>
    </div>
  );
};

const s = {
  preview: css`
    border: 1px solid rgba(var(--color-info-rgb), 0.2);
    border-radius: var(--radius-xl);
    overflow: hidden;
    background: rgba(var(--color-info-rgb), 0.04);
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 9px 12px;
    background: rgba(var(--color-info-rgb), 0.07);
    border-bottom: 1px solid rgba(var(--color-info-rgb), 0.15);
    font-size: 11px;
    font-weight: 600;
    color: var(--color-info);
  `,
  headerLabel: css`
    flex-shrink: 0;
  `,
  headerGoal: css`
    flex: 1;
    min-width: 0;
    font-weight: 400;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  taskList: css`
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 0;
  `,
  task: css`
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 7px 12px;
    &:hover {
      background: var(--bg-input);
    }
  `,
  taskNum: css`
    font-size: 10px;
    font-weight: 700;
    color: var(--text-tertiary);
    min-width: 16px;
    text-align: right;
    padding-top: 1px;
    flex-shrink: 0;
  `,
  taskBody: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  `,
  taskTitle: css`
    font-size: 12px;
    color: var(--text-primary);
    font-weight: 500;
  `,
  taskMeta: css`
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  `,
  taskAgent: css`
    font-size: 10px;
    color: var(--color-brand);
    font-weight: 600;
    background: rgba(var(--color-brand-rgb), 0.1);
    padding: 1px 6px;
    border-radius: 99px;
    border: 1px solid transparent;
    font-family: inherit;
    cursor: pointer;
    max-width: 140px;
  `,
  taskAgentMissing: css`
    color: var(--color-warning);
    background: rgba(var(--color-warning-rgb), 0.1);
    border-color: rgba(var(--color-warning-rgb), 0.3);
  `,
  taskGate: css`
    font-size: 10px;
    color: var(--color-warning);
    font-weight: 600;
    background: rgba(var(--color-warning-rgb), 0.1);
    padding: 1px 6px;
    border-radius: 99px;
    border: 1px solid rgba(var(--color-warning-rgb), 0.3);
  `,
  taskDeps: css`
    font-size: 10px;
    color: var(--text-tertiary);
  `,

  modeBar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    margin: 6px 10px 0;
    background: var(--bg-canvas);
    border: 1px solid rgba(var(--color-info-rgb), 0.15);
    border-radius: var(--radius-xl);
  `,
  modeLabel: css`
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
  `,
  modeToggle: css`
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 2px;
  `,
  modeBtn: css`
    display: flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover {
      color: var(--text-primary);
    }
  `,
  modeBtnActive: css`
    background: var(--color-brand);
    color: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    &:hover {
      color: #fff;
    }
  `,

  actions: css`
    display: flex;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid rgba(var(--color-info-rgb), 0.12);
    background: var(--bg-canvas);
  `,
  runBtn: css`
    flex: 1;
    padding: 7px 12px;
    border-radius: 6px;
    border: none;
    background: var(--color-info);
    color: var(--bg-secondary);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 150ms ease;
    &:hover:not(:disabled) {
      filter: brightness(1.1);
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `,
  discardBtn: css`
    padding: 7px 14px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-tertiary);
    font-size: 12px;
    cursor: pointer;
    transition: all 150ms ease;
    &:hover {
      border-color: var(--color-error);
      color: var(--color-error);
    }
  `,
};
