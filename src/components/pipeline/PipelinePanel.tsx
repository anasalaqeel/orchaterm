/*
 * PipelinePanel.tsx
 *
 * Container that hosts the Builder / Live Run / History sub-tabs.
 * All state is owned by the parent RightPanel and passed down as props.
 */
import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { Workflow, Activity, History as HistoryIcon } from 'lucide-react';
import type { OrchestratorPlan, OrchestratorTask, PipelineTemplate, TerminalSession } from '../../types';
import { PipelineBuilder } from './PipelineBuilder';
import { PipelineLiveBoard } from './PipelineLiveBoard';
import { PipelineHistory } from './PipelineHistory';

type SubTab = 'builder' | 'live' | 'history';

interface PipelinePanelProps {
  workspaceId: string;

  // Builder state
  buildTasks: OrchestratorTask[];
  setBuildTasks: (next: OrchestratorTask[]) => void;
  executionMode: 'sequential' | 'parallel';
  setExecutionMode: (mode: 'sequential' | 'parallel') => void;
  pendingPlan: { goal: string; tasks: OrchestratorTask[] } | null;
  onRunPending: () => void;
  onDiscardPending: () => void;
  onRunBuild: () => void;
  onSaveTemplate: (t: Omit<PipelineTemplate, 'id' | 'createdAt' | 'usedAt' | 'useCount'>) => void;
  aiDisabled?: boolean;

  // Live board
  livePlan: OrchestratorPlan | null;
  onDismissLive: () => void;
  /** Re-run a finished plan with fresh task IDs, preserving deps. */
  onRerunPlan: (plan: OrchestratorPlan) => void;

  // Sessions / space info
  sessions: TerminalSession[];

  /** Pin the active sub-tab from the parent (e.g. parent flips to "live" on Run). */
  pinnedSubTab?: SubTab;
  onSubTabChange?: (tab: SubTab) => void;
}

export const PipelinePanel: React.FC<PipelinePanelProps> = ({
  workspaceId,
  buildTasks,
  setBuildTasks,
  executionMode,
  setExecutionMode,
  pendingPlan,
  onRunPending,
  onDiscardPending,
  onRunBuild,
  onSaveTemplate,
  aiDisabled,
  livePlan,
  onDismissLive,
  onRerunPlan,
  sessions,
  pinnedSubTab,
  onSubTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<SubTab>('builder');
  const activeTab = pinnedSubTab ?? internalTab;
  const setTab = (t: SubTab) => {
    setInternalTab(t);
    onSubTabChange?.(t);
  };

  const sessionOpts = sessions.map(s => ({ id: s.id, title: s.title, color: s.color }));

  return (
    <div className={s.root}>
      <div className={s.tabs}>
        <div className={s.tabsInner}>
          <button
            className={cx(s.tab, activeTab === 'builder' && s.tabActive)}
            onClick={() => setTab('builder')}
            title="Build a pipeline manually or from a generated plan"
          >
            <Workflow size={11} />
            Builder
            {pendingPlan && <span className={s.tabDot} title="Pending plan awaiting confirmation" />}
          </button>
          <button
            className={cx(s.tab, activeTab === 'live' && s.tabActive)}
            onClick={() => setTab('live')}
            title="Live execution board"
          >
            <Activity size={11} />
            Live Run
            {livePlan && (
              <span
                className={cx(s.tabDot, s.tabDotLive)}
                style={{ background:
                  livePlan.status === 'running' ? 'var(--color-brand)' :
                  livePlan.status === 'done'    ? 'var(--color-success)' :
                  livePlan.status === 'failed'  ? 'var(--color-error)'  :
                  'var(--text-tertiary)' }}
              />
            )}
          </button>
          <button
            className={cx(s.tab, activeTab === 'history' && s.tabActive)}
            onClick={() => setTab('history')}
            title="Past pipelines for this workspace"
          >
            <HistoryIcon size={11} />
            History
          </button>
        </div>
      </div>

      <div className={s.body}>
        {activeTab === 'builder' && (
          <PipelineBuilder
            tasks={buildTasks}
            setTasks={setBuildTasks}
            executionMode={executionMode}
            setExecutionMode={setExecutionMode}
            sessions={sessionOpts}
            pendingPlan={pendingPlan}
            onRunPending={onRunPending}
            onDiscardPending={onDiscardPending}
            onRunBuild={onRunBuild}
            onSaveTemplate={onSaveTemplate}
            disabled={aiDisabled}
          />
        )}

        {activeTab === 'live' && (
          <PipelineLiveBoard
            plan={livePlan}
            onDismiss={onDismissLive}
            onRerun={onRerunPlan}
            sessions={sessions}
          />
        )}

        {activeTab === 'history' && (
          <PipelineHistory workspaceId={workspaceId} onRerunPlan={onRerunPlan} />
        )}
      </div>
    </div>
  );
};

const s = {
  root: css`
    display: flex; flex-direction: column;
    flex: 1; min-height: 0; height: 100%;
    background: var(--bg-canvas); overflow: hidden;
  `,
  tabs: css`
    flex-shrink: 0;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
  `,
  tabsInner: css`
    display: flex; gap: 2px;
    background: var(--bg-canvas);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    padding: 3px;
  `,
  tab: css`
    display: flex; align-items: center; gap: 5px;
    padding: 5px 12px;
    border-radius: 99px;
    font-size: 11px; font-weight: 600;
    color: var(--text-tertiary);
    background: transparent;
    border: none; cursor: pointer;
    transition: color 0.15s, background 0.15s;
    white-space: nowrap;
    position: relative;
    &:hover { color: var(--text-secondary); }
  `,
  tabActive: css`
    background: var(--color-brand) !important;
    color: #fff !important;
    box-shadow: 0 2px 6px rgba(var(--color-brand-rgb), 0.3);
    &:hover { color: #fff; }
  `,
  tabDot: css`
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--color-info);
    flex-shrink: 0;
  `,
  tabDotLive: css`
    animation: tabdotpulse 1.2s ease-in-out infinite;
    @keyframes tabdotpulse {
      0%,100% { transform: scale(1); opacity: 1; }
      50%     { transform: scale(1.3); opacity: 0.6; }
    }
  `,
  body: css`
    flex: 1; min-height: 0;
    display: flex; flex-direction: column;
  `,
};
