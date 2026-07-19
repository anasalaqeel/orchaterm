/*
 * RightPanel.tsx
 *
 * Right-hand wrapper that sits between ConsoleSplit and the GroupChat /
 * PipelinePanel. Owns all pipeline-related state (pendingPlan, livePlan,
 * buildTasks, executionMode) so both tabs see the same live data, and so the
 * Chat tab can hand a generated plan off to the Pipeline tab.
 *
 * Also subscribes to orchestratorEngine log/state events — the chat feed
 * surfaces log lines via a window event so GroupChat can render them as
 * "conductor" rows without owning the subscription.
 *
 * Listens for the `orchaterm:load-template` window event emitted by the
 * sidebar / Pipelines page — preloads the builder with template tasks.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { css, cx } from '@emotion/css';
import { MessageSquare, Workflow } from 'lucide-react';
import { GroupChat } from '../ui/GroupChat';
import { PipelinePanel } from '../pipeline/PipelinePanel';
import { useDashboard } from '../../context/DashboardContext';
import { orchestratorEngine } from '../../services/orchestratorEngine';
import type {
  OrchestratorPlan, OrchestratorTask, PipelineTemplate,
} from '../../types';

type ActiveTab = 'chat' | 'pipeline';
type SubTab = 'builder' | 'live' | 'history';

interface RightPanelProps {
  workspaceId: string;
}

interface PendingPlan {
  goal: string;
  tasks: OrchestratorTask[];
}

export const RightPanel: React.FC<RightPanelProps> = ({ workspaceId }) => {
  const {
    spaces, terminalSessions,
    activeSpaceId, settings, llmProviders,
    addPlan, addPipelineTemplate, incrementTemplateUse,
    pipelineTemplates, showToast,
  } = useDashboard();

  const aiEnabled = settings.aiEnabled !== false;

  const activeSpace   = spaces.find(g => g.id === activeSpaceId);
  const allSessions   = terminalSessions.filter(s => s.workspaceId === workspaceId);
  const groupSessions = activeSpace
    ? allSessions.filter(s => activeSpace.sessionIds.includes(s.id))
    : allSessions;

  // ── Top-level tab + sub-tab ────────────────────────────────────────────────
  const [activeTab, setActiveTab]       = useState<ActiveTab>('chat');
  const [pinnedSubTab, setPinnedSubTab] = useState<SubTab | undefined>(undefined);

  // ── Pipeline state (lifted from GroupChat) ──────────────────────────────────
  const [pendingPlan,   setPendingPlan]   = useState<PendingPlan | null>(null);
  const [livePlan,      setLivePlan]      = useState<OrchestratorPlan | null>(null);
  const [buildTasks,    setBuildTasks]    = useState<OrchestratorTask[]>([]);
  const [executionMode, setExecutionMode] = useState<'sequential' | 'parallel'>('sequential');

  // ── Engine subscription: state + log → re-renders + chat feed relay ────────
  useEffect(() => {
    const unsubLog = orchestratorEngine.onLog((entry) => {
      if (entry.workspaceId && entry.workspaceId !== workspaceId) return;
      // Forward to GroupChat via a CustomEvent so it can render a "conductor" row.
      window.dispatchEvent(new CustomEvent('orchaterm:conductor-log', { detail: entry }));
    });
    const unsubState = orchestratorEngine.onStateChange((plan) => {
      setLivePlan({ ...plan });
    });
    const existing = orchestratorEngine.getCurrentPlan();
    if (existing) setLivePlan({ ...existing });
    return () => { unsubLog(); unsubState(); };
  }, [workspaceId]);

  // Keep livePlan visible indefinitely once reached a terminal state until dismissed
  // — matching prior GroupChat behaviour.

  // ── Pending plan (from chat) → flip to Pipeline tab automatically ───────────
  const handlePendingPlan = useCallback((goal: string, tasks: OrchestratorTask[]) => {
    setPendingPlan({ goal, tasks });
    setActiveTab('pipeline');
    setPinnedSubTab('builder');
  }, []);

  // ── Run pending plan (manual or chat-generated) ─────────────────────────────
  const runPlan = useCallback((plan: PendingPlan) => {
    if (!aiEnabled) return;
    const currentPlan = orchestratorEngine.getCurrentPlan();
    if (currentPlan?.status === 'running' || currentPlan?.status === 'paused') {
      showToast('A plan is already running — stop it first via the Live Run tab', 'error');
      return;
    }

    const finalTasks = plan.tasks.map((t, idx) => ({
      ...t,
      dependsOn: executionMode === 'sequential'
        ? (idx > 0 ? [plan.tasks[idx - 1].id] : [])
        : [],
    }));

    const orchPlan: OrchestratorPlan = {
      id:            crypto.randomUUID(),
      goal:          plan.goal,
      tasks:         finalTasks,
      status:        'approved',
      createdAt:     Date.now(),
      workspaceId,
      spaceId:       activeSpaceId ?? null,
      executionMode,
    };

    orchestratorEngine.updateConfig({
      relayProvider:      llmProviders.relay,
      planGenProvider:    llmProviders.planGen,
      autoAnswerProvider: llmProviders.autoAnswer,
      taskTimeoutMinutes: settings.conductorTaskTimeoutMinutes,
      interactionMode:    settings.conductorInteractionMode,
      sessionTitles:      new Map(groupSessions.map(s => [s.id, s.title])),
    });

    orchestratorEngine.start(orchPlan);
    addPlan(orchPlan);
    setPendingPlan(null);
    setPinnedSubTab('live');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEnabled, executionMode, activeSpaceId, workspaceId, groupSessions, settings, addPlan, llmProviders, showToast]);

  const handleRunPending = useCallback(() => {
    if (pendingPlan) runPlan(pendingPlan);
  }, [pendingPlan, runPlan]);

  const handleDiscardPending = useCallback(() => {
    setPendingPlan(null);
    showToast('Plan discarded', 'info');
  }, [showToast]);

  const handleRunBuild = useCallback(() => {
    if (!aiEnabled || buildTasks.length === 0) return;
    runPlan({
      goal:  buildTasks.map(t => t.title).join(' → '),
      tasks: buildTasks,
    });
  }, [aiEnabled, buildTasks, runPlan]);

  const handleDismissLive = useCallback(() => {
    setLivePlan(null);
    orchestratorEngine.clearPlan();
  }, []);

  // ── Re-run an existing plan (from Live Run terminal state or History) ───────
  // Allocates fresh task IDs so the new plan doesn't collide with the source in
  // History. Preserves the original dependency graph rather than re-deriving it
  // from executionMode — re-run means "same pipeline again".
  const handleRerun = useCallback((sourcePlan: OrchestratorPlan) => {
    if (!aiEnabled) {
      showToast('Enable AI features to re-run a pipeline', 'error');
      return;
    }
    const currentPlan = orchestratorEngine.getCurrentPlan();
    if (currentPlan?.status === 'running' || currentPlan?.status === 'paused') {
      showToast('A plan is already running — stop it first via the Live Run tab', 'error');
      return;
    }
    if (sourcePlan.tasks.length === 0) {
      showToast('Cannot re-run an empty plan', 'error');
      return;
    }

    const newIds = sourcePlan.tasks.map(() => crypto.randomUUID());
    const freshTasks: OrchestratorTask[] = sourcePlan.tasks.map((t, i) => ({
      id:                   newIds[i],
      title:                t.title,
      description:          t.description,
      assignedSessionId:    t.assignedSessionId,
      assignedSessionTitle: t.assignedSessionTitle,
      dependsOn:            t.dependsOn
        .map(oldId => {
          const idx = sourcePlan.tasks.findIndex(tt => tt.id === oldId);
          return idx >= 0 ? newIds[idx] : '';
        })
        .filter(Boolean),
      status: 'pending' as const,
    }));

    const orchPlan: OrchestratorPlan = {
      id:            crypto.randomUUID(),
      goal:          sourcePlan.goal,
      tasks:         freshTasks,
      status:        'approved',
      createdAt:     Date.now(),
      workspaceId,
      spaceId:       sourcePlan.spaceId ?? activeSpaceId ?? null,
      executionMode: sourcePlan.executionMode,
    };

    orchestratorEngine.updateConfig({
      relayProvider:      llmProviders.relay,
      planGenProvider:    llmProviders.planGen,
      autoAnswerProvider: llmProviders.autoAnswer,
      taskTimeoutMinutes: settings.conductorTaskTimeoutMinutes,
      interactionMode:    settings.conductorInteractionMode,
      sessionTitles:      new Map(groupSessions.map(s => [s.id, s.title])),
    });

    orchestratorEngine.start(orchPlan);
    addPlan(orchPlan);
    setPendingPlan(null);
    setActiveTab('pipeline');
    setPinnedSubTab('live');
    showToast(`Re-running "${sourcePlan.goal.slice(0, 60)}${sourcePlan.goal.length > 60 ? '…' : ''}"`, 'success');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEnabled, workspaceId, activeSpaceId, groupSessions, settings, addPlan, llmProviders, showToast]);

  // ── Save-as-template ───────────────────────────────────────────────────────
  const handleSaveTemplate = useCallback((t: Omit<PipelineTemplate, 'id' | 'createdAt' | 'usedAt' | 'useCount'>) => {
    addPipelineTemplate(t);
  }, [addPipelineTemplate]);

  // ── Sidebar / Pipelines page → load a template into the builder ────────────
  useEffect(() => {
    const onLoadTemplate = (e: Event) => {
      const detail = (e as CustomEvent<{ templateId: string }>).detail;
      if (!detail?.templateId) return;
      const tpl = pipelineTemplates.find(t => t.id === detail.templateId);
      if (!tpl) return;

      // First pass: allocate IDs.
      const newIds = tpl.tasks.map(() => crypto.randomUUID());

      // Soft-match each template task's agentHint against current session titles.
      const matchSession = (hint?: string) => {
        if (!hint) return undefined;
        const lc = hint.toLowerCase();
        return groupSessions.find(s => s.title.toLowerCase().includes(lc));
      };

      const tasks: OrchestratorTask[] = tpl.tasks.map((tt, i) => {
        const session = matchSession(tt.agentHint);
        return {
          id:                   newIds[i],
          title:                tt.title,
          description:          tt.description,
          assignedSessionId:    session?.id ?? '',
          assignedSessionTitle: session?.title ?? '(assign tab)',
          dependsOn:            tt.dependsOnIndices
            .map(j => newIds[j])
            .filter(Boolean),
          status:               'pending' as const,
        };
      });

      setBuildTasks(tasks);
      setExecutionMode(tpl.executionMode);
      setActiveTab('pipeline');
      setPinnedSubTab('builder');
      setPendingPlan(null);
      void incrementTemplateUse(tpl.id);
      showToast(`Loaded template "${tpl.title}" — assign agents then Run`, 'success');
    };

    window.addEventListener('orchaterm:load-template', onLoadTemplate as EventListener);
    return () => window.removeEventListener('orchaterm:load-template', onLoadTemplate as EventListener);
  }, [pipelineTemplates, groupSessions, incrementTemplateUse, showToast]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className={s.root}>
      <div className={s.tabs}>
        <div className={s.tabsInner}>
          <button
            className={cx(s.tab, activeTab === 'chat' && s.tabActive)}
            onClick={() => setActiveTab('chat')}
            title="Chat with AI or generate plans"
          >
            <MessageSquare size={11} />
            Chat
          </button>
          <button
            className={cx(s.tab, activeTab === 'pipeline' && s.tabActive)}
            onClick={() => { setActiveTab('pipeline'); setPinnedSubTab(undefined); }}
            title="Build & monitor task pipelines"
          >
            <Workflow size={11} />
            Pipeline
            {livePlan && (
              <span
                className={s.tabDot}
                style={{ background:
                  livePlan.status === 'running' ? 'var(--color-brand)' :
                  livePlan.status === 'done'    ? 'var(--color-success)' :
                  livePlan.status === 'failed'  ? 'var(--color-error)'  :
                  'var(--text-tertiary)' }}
              />
            )}
            {pendingPlan && <span className={cx(s.tabDot, s.tabDotPending)} />}
          </button>
        </div>
      </div>

      <div className={s.body}>
        {/* GroupChat stays mounted (keyed by workspaceId) so chat history survives tab switches. */}
        <div className={cx(s.layer, activeTab === 'chat' ? s.layerVisible : s.layerHidden)}>
          <GroupChat
            key={`chat-${workspaceId}`}
            workspaceId={workspaceId}
            onPendingPlan={handlePendingPlan}
          />
        </div>

        <div className={cx(s.layer, activeTab === 'pipeline' ? s.layerVisible : s.layerHidden)}>
          <PipelinePanel
            workspaceId={workspaceId}
            buildTasks={buildTasks}
            setBuildTasks={setBuildTasks}
            executionMode={executionMode}
            setExecutionMode={setExecutionMode}
            pendingPlan={pendingPlan}
            onRunPending={handleRunPending}
            onDiscardPending={handleDiscardPending}
            onRunBuild={handleRunBuild}
            onSaveTemplate={handleSaveTemplate}
            aiDisabled={!aiEnabled}
            livePlan={livePlan}
            onDismissLive={handleDismissLive}
            onRerunPlan={handleRerun}
            sessions={groupSessions}
            pinnedSubTab={pinnedSubTab}
            onSubTabChange={() => setPinnedSubTab(undefined)}
          />
        </div>
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
    padding: 8px 10px 0;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
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
    padding: 5px 14px;
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
    background: var(--text-tertiary); flex-shrink: 0;
    animation: tabdotpulse 1.2s ease-in-out infinite;
    @keyframes tabdotpulse {
      0%,100% { transform: scale(1); opacity: 1; }
      50%     { transform: scale(1.3); opacity: 0.6; }
    }
  `,
  tabDotPending: css`
    background: var(--color-info);
  `,
  body: css`
    flex: 1; min-height: 0;
    display: flex; flex-direction: column;
    position: relative;
  `,
  layer: css`
    flex: 1; min-height: 0;
    display: flex; flex-direction: column;
  `,
  layerVisible: css`
    flex: 1;
  `,
  layerHidden: css`
    display: none;
  `,
};
