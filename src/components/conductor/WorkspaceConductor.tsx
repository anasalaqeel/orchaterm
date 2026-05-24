/**
 * WorkspaceConductor.tsx
 *
 * Compact, workspace-scoped Conductor embedded in the right panel of the
 * workspace console view. Shows only plans that belong to this workspace.
 * New plans created here are automatically tagged with workspaceId.
 *
 * This is a slimmer sibling of the full ConductorView (/conductor route):
 * - No left plan-list sidebar — plans are selected via a top dropdown
 * - Same PlanBuilder / PipelineBoard / History tab content
 * - Same engine subscriptions and run controls
 */

import React, { useEffect, useState, useCallback } from 'react';
import { css, cx } from '@emotion/css';
import { v4 as uuidv4 } from 'uuid';
import { useDashboard } from '../../context/DashboardContext';
import {
  OrchestratorPlan,
  OrchestratorTask,
  ConductorLogEntry,
} from '../../types';
import { orchestratorEngine } from '../../services/orchestratorEngine';
import { SENTINEL_START, SENTINEL_END, PLAN_START, PLAN_END } from '../../services/sentinelParser';
import { SessionRegistry } from './SessionRegistry';
import { PlanBuilder } from './PlanBuilder';
import { PipelineBoard, PipelineSummary } from './PipelineBoard';
import { ConductorLog } from './ConductorLog';
import { ManualOverridePanel } from './ManualOverridePanel';
import { TaskCard } from './TaskCard';
import {
  Network, Play, Pause, Square, ClipboardList, GitBranch,
  History, Plus, Trash2, BookOpen, Copy, Check,
  ChevronDown, ChevronUp, X as XIcon,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab = 'build' | 'run' | 'history';

interface WorkspaceConductorProps {
  workspaceId: string;
}

// ── Sentinel Protocol text ─────────────────────────────────────────────────────

const PROTOCOL_MD = `# AgentDeck Sentinel Protocol

This workspace is orchestrated by AgentDeck. You will receive task prompts via
your terminal. When you have FULLY completed a task, output this exact signal
block on its own lines — no extra text before or after:

${SENTINEL_START}
task_id: <copy the task_id from your prompt exactly>
summary: [2-3 sentences: what you built, what changed, key decisions made]
files_modified: [comma-separated list of files created or modified, or "none"]
needs: [what the next agent must know to continue, or "none"]
${SENTINEL_END}

## Rules
- Output this block ONLY when the task is truly complete.
- Do not output it mid-task or as a draft.
- Copy the task_id character-for-character from your prompt.
- Be specific in "needs" — it is relayed to the next agent as their brief.

---

## Plan Generation (optional)

If asked to generate an orchestration plan, output a JSON task array wrapped
in these exact markers (nothing outside the markers):

${PLAN_START}
[
  {
    "id": "task-1",
    "title": "Short task name",
    "description": "Full instructions for this task",
    "assignedSessionId": "<session-id-from-prompt>",
    "dependsOn": []
  }
]
${PLAN_END}
`;

// ── Status colors ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft:    'var(--text-tertiary)',
  approved: 'var(--color-brand)',
  running:  'var(--color-brand)',
  paused:   '#f59e0b',
  done:     '#10b981',
  failed:   '#ef4444',
};

// ── WorkspaceConductor ─────────────────────────────────────────────────────────

export const WorkspaceConductor: React.FC<WorkspaceConductorProps> = ({ workspaceId }) => {
  const {
    plans, addPlan, updatePlan, deletePlan,
    agents, terminalSessions, settings, showToast,
  } = useDashboard();

  const [tab,           setTab]           = useState<Tab>('build');
  const [activePlanId,  setActivePlanId]  = useState<string | null>(null);
  const [liveTasks,     setLiveTasks]     = useState<OrchestratorTask[]>([]);
  const [logEntries,    setLogEntries]    = useState<ConductorLogEntry[]>([]);
  const [engineRunning, setEngineRunning] = useState(false);
  const [showProtocol,  setShowProtocol]  = useState(false);
  const [protocolCopied, setProtocolCopied] = useState(false);

  // ── Workspace-scoped slices ────────────────────────────────────────────────

  const workspacePlans    = plans.filter(p => p.workspaceId === workspaceId);
  const workspaceSessions = terminalSessions.filter(s => s.workspaceId === workspaceId);
  const historyPlans      = workspacePlans.filter(p => p.status === 'done'  || p.status === 'failed');

  // Keep activePlanId pointing at a valid plan for this workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ids = workspacePlans.map(p => p.id);
    if (activePlanId && !ids.includes(activePlanId)) {
      setActivePlanId(ids[0] ?? null);
    } else if (!activePlanId && ids.length > 0) {
      setActivePlanId(ids[0]);
    }
  }, [workspacePlans.map(p => p.id).join(',')]);

  const activePlan = workspacePlans.find(p => p.id === activePlanId) ?? null;

  // ── Engine subscriptions ──────────────────────────────────────────────────

  useEffect(() => {
    const unsubState = orchestratorEngine.onStateChange((plan) => {
      // Ignore engine events that belong to a different workspace
      if (plan.workspaceId && plan.workspaceId !== workspaceId) return;

      setLiveTasks([...plan.tasks]);
      setEngineRunning(plan.status === 'running');

      if (plan.status === 'done' || plan.status === 'failed') {
        updatePlan(plan.id, { status: plan.status, completedAt: plan.completedAt });
      }
      if (plan.status === 'done') {
        const n = plan.tasks.filter(t => t.status === 'done').length;
        showToast(`✅ Orchestration complete — ${n} task${n !== 1 ? 's' : ''} finished`, 'success');
      } else if (plan.status === 'failed') {
        showToast('❌ Orchestration failed — check the Conductor log for details', 'error');
      }
    });

    const unsubLog = orchestratorEngine.onLog((entry) => {
      setLogEntries(prev => [...prev, entry]);
    });

    return () => { unsubState(); unsubLog(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Plan CRUD ─────────────────────────────────────────────────────────────

  const handleNewPlan = () => {
    const blank: OrchestratorPlan = {
      id: uuidv4(), goal: '', tasks: [], status: 'draft',
      createdAt: Date.now(), workspaceId,
    };
    addPlan(blank);
    setActivePlanId(blank.id);
    setTab('build');
  };

  const handleDeletePlan = (id: string) => {
    const enginePlan = orchestratorEngine.getCurrentPlan();
    if (enginePlan?.id === id) orchestratorEngine.stop();
    deletePlan(id);
    setActivePlanId(workspacePlans.find(p => p.id !== id)?.id ?? null);
  };

  // ── Run controls ─────────────────────────────────────────────────────────

  const buildSessionRegistry = useCallback(() => {
    return new Map(
      workspaceSessions
        .filter(s => s.assignedAgentId)
        .map(s => {
          const agent = agents.find(a => a.id === s.assignedAgentId);
          return [s.id, {
            sessionId:  s.id,
            agentId:    s.assignedAgentId!,
            agentName:  agent?.name  ?? 'Unknown',
            agentColor: agent?.color ?? '#475569',
          }];
        })
    );
  }, [workspaceSessions, agents]);

  const handleApproveAndRun = async (plan: OrchestratorPlan) => {
    await updatePlan(plan.id, plan);
    setActivePlanId(plan.id);
    setTab('run');
    setLogEntries([]);
    setLiveTasks([]);

    orchestratorEngine.updateConfig({
      ollamaHost:             settings.ollamaHost,
      ollamaModel:            settings.conductorOllamaModel,
      taskTimeoutMinutes:     settings.conductorTaskTimeoutMinutes,
      sessionRegistry:        buildSessionRegistry(),
    });
    orchestratorEngine.stop();
    orchestratorEngine.start(plan);
  };

  const handlePause  = () => orchestratorEngine.pause();
  const handleResume = () => orchestratorEngine.resume();
  const handleStop   = () => orchestratorEngine.stop();

  // ── Protocol helpers ──────────────────────────────────────────────────────

  const handleCopyProtocol = () => {
    navigator.clipboard.writeText(PROTOCOL_MD).then(() => {
      setProtocolCopied(true);
      setTimeout(() => setProtocolCopied(false), 2000);
    });
  };

  const handleDownloadProtocol = () => {
    const blob = new Blob([PROTOCOL_MD], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'CLAUDE.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={s.root}>

      {/* ── Protocol modal ── */}
      {showProtocol && (
        <div className={s.modalBackdrop} onClick={() => setShowProtocol(false)}>
          <div className={s.modalBox} onClick={e => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <BookOpen className={s.modalHeaderIcon} />
              <span className={s.modalHeaderTitle}>Agent Protocol Instructions</span>
              <span className={s.modalHeaderHint}>
                Add this to CLAUDE.md in your project, or paste it into each agent session
              </span>
              <button className={s.modalClose} onClick={() => setShowProtocol(false)} title='Close (Esc)'>
                <XIcon className={s.modalCloseIcon} />
              </button>
            </div>
            <pre className={s.modalPre}>{PROTOCOL_MD}</pre>
            <div className={s.modalActions}>
              <button className={s.modalCopyBtn} onClick={handleCopyProtocol}>
                {protocolCopied
                  ? <><Check className={s.modalBtnIcon} /> Copied!</>
                  : <><Copy className={s.modalBtnIcon} /> Copy to Clipboard</>
                }
              </button>
              <button className={s.modalDownloadBtn} onClick={handleDownloadProtocol}>
                Download as CLAUDE.md
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Plan selector row ── */}
      <div className={s.planSelectorRow}>
        <Network className={s.planSelectorIcon} />
        <select
          className={s.planSelect}
          value={activePlanId ?? ''}
          onChange={e => {
            setActivePlanId(e.target.value || null);
            setTab('build');
          }}
        >
          {workspacePlans.length === 0 && (
            <option value=''>No plans — click + to create</option>
          )}
          {workspacePlans.map(p => (
            <option key={p.id} value={p.id}>
              {p.goal || 'Untitled plan'} · {p.status}
            </option>
          ))}
        </select>

        {activePlan && (
          <button
            className={s.iconBtn}
            onClick={() => handleDeletePlan(activePlan.id)}
            title='Delete this plan'
          >
            <Trash2 className={s.tinyIcon} />
          </button>
        )}
        <button
          className={s.iconBtn}
          onClick={() => setShowProtocol(true)}
          title='Show agent protocol instructions (CLAUDE.md)'
        >
          <BookOpen className={s.tinyIcon} />
        </button>
        <button
          className={cx(s.iconBtn, s.iconBtnAccent)}
          onClick={handleNewPlan}
          title='New plan'
        >
          <Plus className={s.tinyIcon} />
        </button>
      </div>

      {/* ── Tab bar ── */}
      <div className={s.tabBar}>
        <TabBtn id='build'   active={tab} label='Build'    icon={ClipboardList} onClick={setTab} />
        <TabBtn id='run'     active={tab} label='Pipeline' icon={GitBranch}     onClick={setTab} />
        <TabBtn id='history' active={tab} label='History'  icon={History}       onClick={setTab} />

        {tab === 'run' && liveTasks.length > 0 && (
          <div className={s.runControls}>
            {engineRunning ? (
              <>
                <button className={s.controlBtn} onClick={handlePause} title='Pause (P)'>
                  <Pause className={s.controlIcon} /> Pause
                </button>
                <button
                  className={cx(s.controlBtn, s.controlBtnDanger)}
                  onClick={handleStop}
                  title='Stop (S)'
                >
                  <Square className={s.controlIcon} /> Stop
                </button>
              </>
            ) : (
              <>
                <button className={s.controlBtn} onClick={handleResume} title='Resume (R)'>
                  <Play className={s.controlIcon} /> Resume
                </button>
                <button
                  className={s.controlBtn}
                  onClick={() => { setLiveTasks([]); setLogEntries([]); }}
                  title='Clear run from view'
                >
                  Clear
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Tab content ── */}
      <div className={s.content}>

        {/* Build tab */}
        {tab === 'build' && (
          <div className={s.buildLayout}>
            <SessionRegistry workspaceId={workspaceId} />
            {activePlan ? (
              <PlanBuilder
                key={activePlan.id}
                plan={activePlan}
                sessions={workspaceSessions}
                agents={agents}
                onSave={updated => updatePlan(updated.id, updated)}
                onApproveAndRun={handleApproveAndRun}
              />
            ) : (
              <div className={s.emptyState}>
                <Network className={s.emptyIcon} />
                <p className={s.emptyTitle}>No plans for this workspace</p>
                <p className={s.emptyHint}>
                  Create a plan to start orchestrating your agents across the terminal sessions above.
                </p>
                <button className={s.emptyCreateBtn} onClick={handleNewPlan}>
                  <Plus className={s.tinyIcon} /> New Plan
                </button>
              </div>
            )}
          </div>
        )}

        {/* Run / Pipeline tab */}
        {tab === 'run' && (
          <div className={s.runLayout}>
            {liveTasks.length > 0 ? (
              <>
                <PipelineSummary tasks={liveTasks} />
                <PipelineBoard
                  tasks={liveTasks}
                  sessions={workspaceSessions}
                  agents={agents}
                />
                <div className={s.runBottom}>
                  <div className={s.logSection}>
                    <div className={s.sectionLabel}>Orchestrator Log</div>
                    <ConductorLog entries={logEntries} maxHeight={220} />
                  </div>
                  <div className={s.overrideSection}>
                    <div className={s.sectionLabel}>Manual Override</div>
                    <ManualOverridePanel
                      tasks={liveTasks}
                      sessions={workspaceSessions}
                      isRunning={engineRunning}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className={s.placeholder}>
                <Play className={s.placeholderIcon} />
                <span>Approve and run a plan from the Build tab.</span>
              </div>
            )}
          </div>
        )}

        {/* History tab */}
        {tab === 'history' && (
          <div className={s.historyLayout}>
            {historyPlans.length === 0 ? (
              <div className={s.placeholder}>
                <History className={s.placeholderIcon} />
                <span>No completed plans for this workspace yet.</span>
              </div>
            ) : (
              historyPlans.map(p => (
                <HistoryCard
                  key={p.id}
                  plan={p}
                  sessions={workspaceSessions}
                  agents={agents}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────────

// ── TabBtn ─────────────────────────────────────────────────────────────────────

const TabBtn: React.FC<{
  id: Tab; active: Tab; label: string;
  icon: React.ElementType; onClick: (id: Tab) => void;
}> = ({ id, active, label, icon: Icon, onClick }) => (
  <button
    className={cx(s.tab, active === id && s.tabActive)}
    onClick={() => onClick(id)}
  >
    <Icon className={s.tabIcon} />
    {label}
  </button>
);

// ── HistoryCard ────────────────────────────────────────────────────────────────

const HistoryCard: React.FC<{
  plan: OrchestratorPlan;
  sessions: ReturnType<typeof Array.prototype.filter>;
  agents: any[];
}> = ({ plan, sessions, agents }) => {
  const [open, setOpen] = useState(false);
  const color = STATUS_COLORS[plan.status] ?? 'var(--text-tertiary)';
  const done  = plan.tasks.filter(t => t.status === 'done').length;
  const total = plan.tasks.length;

  let duration = '';
  if (plan.completedAt && plan.createdAt) {
    const ms = plan.completedAt - plan.createdAt;
    const s  = Math.floor(ms / 1000);
    const m  = Math.floor(s / 60);
    duration = m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  }

  return (
    <div className={s.histCard}>
      <div
        className={s.histCardHeader}
        onClick={() => setOpen(v => !v)}
        style={{ cursor: 'pointer' }}
      >
        <div className={s.histCardDot} style={{ backgroundColor: color }} />
        <span className={s.histCardGoal}>{plan.goal || 'Untitled plan'}</span>
        <span className={s.histCardStatus} style={{ color }}>{plan.status.toUpperCase()}</span>
        <span className={s.histCardMeta}>
          {done}/{total}
          {duration && ` · ${duration}`}
        </span>
        {open
          ? <ChevronUp className={s.histChevron} />
          : <ChevronDown className={s.histChevron} />
        }
      </div>

      {open && (
        <div className={s.histCardBody}>
          {plan.tasks.length === 0 && (
            <p className={s.histNoTasks}>No tasks recorded.</p>
          )}
          {plan.tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              allTasks={plan.tasks}
              sessions={sessions}
              agents={agents}
              editable={false}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = {
  root: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-primary);
  `,

  /* ── Protocol modal (same as Conductor.tsx) ── */
  modalBackdrop: css`
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  `,
  modalBox: css`
    width: 100%;
    max-width: 700px;
    max-height: 80vh;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 40px rgba(0,0,0,0.4);
  `,
  modalHeader: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-primary);
    flex-shrink: 0;
  `,
  modalHeaderIcon: css`
    width: 14px;
    height: 14px;
    color: var(--color-brand);
    flex-shrink: 0;
  `,
  modalHeaderTitle: css`
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-primary);
  `,
  modalHeaderHint: css`
    font-size: 10px;
    color: var(--text-tertiary);
    flex: 1;
    margin-left: 4px;
  `,
  modalClose: css`
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    padding: 2px;
    transition: color 0.15s;
    &:hover { color: var(--text-primary); }
  `,
  modalCloseIcon: css`
    width: 14px;
    height: 14px;
  `,
  modalPre: css`
    flex: 1;
    overflow-y: auto;
    padding: 16px 18px;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  `,
  modalActions: css`
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-primary);
    flex-shrink: 0;
  `,
  modalCopyBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 7px 14px;
    border-radius: var(--border-radius-sm);
    background: var(--color-brand);
    color: #fff;
    font-size: var(--font-size-xs);
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
    &:hover { opacity: 0.85; }
  `,
  modalDownloadBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 7px 14px;
    border-radius: var(--border-radius-sm);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: 600;
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
    &:hover { background-color: var(--bg-hover); color: var(--text-primary); }
  `,
  modalBtnIcon: css`
    width: 13px;
    height: 13px;
  `,

  /* ── Plan selector row ── */
  planSelectorRow: css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
  `,
  planSelectorIcon: css`
    width: 13px;
    height: 13px;
    color: var(--color-brand);
    flex-shrink: 0;
  `,
  planSelect: css`
    flex: 1;
    min-width: 0;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 4px 8px;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s;
    &:focus { border-color: var(--color-brand); }
  `,
  iconBtn: css`
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 4px;
    cursor: pointer;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    transition: color 0.15s, border-color 0.15s;
    flex-shrink: 0;
    &:hover { color: var(--color-brand); border-color: var(--color-brand); }
  `,
  iconBtnAccent: css`
    background: color-mix(in srgb, var(--color-brand) 10%, transparent);
    border-color: color-mix(in srgb, var(--color-brand) 25%, transparent);
    color: var(--color-brand);
    &:hover {
      background: color-mix(in srgb, var(--color-brand) 18%, transparent);
      border-color: var(--color-brand);
    }
  `,
  tinyIcon: css`
    width: 12px;
    height: 12px;
  `,

  /* ── Tab bar ── */
  tabBar: css`
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-primary);
    padding: 0 12px;
    flex-shrink: 0;
  `,
  tab: css`
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 9px 10px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-tertiary);
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
    margin-bottom: -1px;
    &:hover { color: var(--text-primary); }
  `,
  tabActive: css`
    color: var(--color-brand) !important;
    border-bottom-color: var(--color-brand);
  `,
  tabIcon: css`
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  `,

  runControls: css`
    margin-left: auto;
    display: flex;
    gap: 5px;
    align-items: center;
  `,
  controlBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 9px;
    border-radius: var(--border-radius-sm);
    font-size: 11px;
    font-weight: 600;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
    &:hover { background-color: var(--bg-hover); color: var(--text-primary); }
  `,
  controlBtnDanger: css`
    color: var(--color-danger);
    border-color: var(--color-danger);
    &:hover { background-color: rgba(239,68,68,0.08); color: var(--color-danger); }
  `,
  controlIcon: css`
    width: 11px;
    height: 11px;
  `,

  /* ── Content area ── */
  content: css`
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
    &::-webkit-scrollbar-track { background: transparent; }
  `,

  /* Build tab */
  buildLayout: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
  `,

  /* Empty state (no plans yet) */
  emptyState: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px 16px;
    text-align: center;
    border: 1px dashed var(--border-color);
    border-radius: var(--border-radius-md);
    background: var(--bg-secondary);
  `,
  emptyIcon: css`
    width: 24px;
    height: 24px;
    color: var(--color-brand);
    opacity: 0.4;
  `,
  emptyTitle: css`
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    margin: 0;
  `,
  emptyHint: css`
    font-size: 11px;
    color: var(--text-tertiary);
    margin: 0;
    line-height: 1.5;
    max-width: 280px;
  `,
  emptyCreateBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    border-radius: var(--border-radius-sm);
    background: var(--color-brand);
    color: #fff;
    font-size: var(--font-size-xs);
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
    margin-top: 4px;
    &:hover { opacity: 0.85; }
  `,

  /* Run tab */
  runLayout: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
  `,
  runBottom: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  logSection: css`
    display: flex;
    flex-direction: column;
    gap: 5px;
  `,
  overrideSection: css`
    display: flex;
    flex-direction: column;
    gap: 5px;
  `,
  sectionLabel: css`
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-tertiary);
    padding: 0 2px;
  `,

  /* History tab */
  historyLayout: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  `,
  histCard: css`
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    background-color: var(--bg-secondary);
    overflow: hidden;
  `,
  histCardHeader: css`
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 12px;
    user-select: none;
    &:hover { background-color: var(--bg-hover); }
  `,
  histCardDot: css`
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  histCardGoal: css`
    flex: 1;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  histCardStatus: css`
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.07em;
    flex-shrink: 0;
  `,
  histCardMeta: css`
    font-size: 9px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  `,
  histChevron: css`
    width: 12px;
    height: 12px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  `,
  histCardBody: css`
    border-top: 1px solid var(--border-color);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background-color: var(--bg-primary);
  `,
  histNoTasks: css`
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-style: italic;
    margin: 0;
  `,

  /* Placeholder */
  placeholder: css`
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    padding: 28px 0;
    justify-content: center;
  `,
  placeholderIcon: css`
    width: 15px;
    height: 15px;
    opacity: 0.4;
  `,
};
