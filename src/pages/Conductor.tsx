import React, { useEffect, useState, useCallback, useRef } from 'react';
import { css, cx } from '@emotion/css';
import { v4 as uuidv4 } from 'uuid';
import { useDashboard } from '../context/DashboardContext';
import {
  OrchestratorPlan,
  OrchestratorTask,
  ConductorLogEntry,
} from '../types';
import { orchestratorEngine } from '../services/orchestratorEngine';
import { SENTINEL_START, SENTINEL_END, PLAN_START, PLAN_END } from '../services/sentinelParser';
import { SessionRegistry } from '../components/conductor/SessionRegistry';
import { PlanBuilder } from '../components/conductor/PlanBuilder';
import { PipelineBoard, PipelineSummary } from '../components/conductor/PipelineBoard';
import { ConductorLog } from '../components/conductor/ConductorLog';
import { ManualOverridePanel } from '../components/conductor/ManualOverridePanel';
import { TaskCard } from '../components/conductor/TaskCard';
import {
  Network, Play, Pause, Square, ClipboardList,
  GitBranch, History, ChevronRight, Plus, Trash2,
  BookOpen, Copy, Check, ChevronDown, ChevronUp,
  X as XIcon,
} from 'lucide-react';

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = 'build' | 'run' | 'history';

// ─── Protocol instructions (CLAUDE.md content) ────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export const ConductorView: React.FC = () => {
  const {
    plans,
    addPlan,
    updatePlan,
    deletePlan,
    agents,
    terminalSessions,
    settings,
    activeWorkspaceId,
    showToast,
  } = useDashboard();

  // ── Local state ──────────────────────────────────────────────────────────────

  const [tab, setTab] = useState<Tab>('build');
  const [activePlanId, setActivePlanId] = useState<string | null>(
    plans[0]?.id ?? null
  );
  const [liveTasks, setLiveTasks]   = useState<OrchestratorTask[]>([]);
  const [logEntries, setLogEntries] = useState<ConductorLogEntry[]>([]);
  const [engineRunning, setEngineRunning] = useState(false);
  const [showProtocol, setShowProtocol]   = useState(false);
  const [protocolCopied, setProtocolCopied] = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const activePlan = plans.find(p => p.id === activePlanId) ?? null;
  const workspaceSessions = terminalSessions.filter(
    s => s.workspaceId === activeWorkspaceId
  );

  // ── Engine subscriptions ──────────────────────────────────────────────────────

  useEffect(() => {
    const unsubState = orchestratorEngine.onStateChange((plan) => {
      const tasks = plan.tasks;
      setLiveTasks([...tasks]);
      setEngineRunning(plan.status === 'running');

      if (plan.status === 'done' || plan.status === 'failed') {
        updatePlan(plan.id, { status: plan.status, completedAt: plan.completedAt });
      }
      if (plan.status === 'done') {
        const n = tasks.filter(t => t.status === 'done').length;
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

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

      // P — Pause, R — Resume, S — Stop  (only when not typing)
      if (!inInput && !e.ctrlKey && !e.metaKey) {
        if (e.key === 'p' || e.key === 'P') { e.preventDefault(); handlePause(); }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); handleResume(); }
        if (e.key === 's' || e.key === 'S') { e.preventDefault(); handleStop(); }
      }
      // Escape — close protocol modal
      if (e.key === 'Escape') setShowProtocol(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Plan CRUD helpers ─────────────────────────────────────────────────────────

  const handleNewPlan = () => {
    const blank: OrchestratorPlan = {
      id: uuidv4(), goal: '', tasks: [], status: 'draft', createdAt: Date.now(),
    };
    addPlan(blank);
    setActivePlanId(blank.id);
    setTab('build');
  };

  const handleDeletePlan = (id: string) => {
    deletePlan(id);
    setActivePlanId(plans.find(p => p.id !== id)?.id ?? null);
  };

  // ── Run controls ──────────────────────────────────────────────────────────────

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
    orchestratorEngine.start(plan);
  };

  const handlePause  = () => orchestratorEngine.pause();
  const handleResume = () => orchestratorEngine.resume();
  const handleStop   = () => orchestratorEngine.stop();

  // ── Protocol copy ─────────────────────────────────────────────────────────────

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

  // ── Derived plan lists ────────────────────────────────────────────────────────

  const historyPlans = plans.filter(p => p.status === 'done' || p.status === 'failed');
  const draftPlans   = plans.filter(p => p.status !== 'done' && p.status !== 'failed');

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>

      {/* ── Protocol modal ── */}
      {showProtocol && (
        <div className={styles.modalBackdrop} onClick={() => setShowProtocol(false)}>
          <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <BookOpen className={styles.modalHeaderIcon} />
              <span className={styles.modalHeaderTitle}>Agent Protocol Instructions</span>
              <span className={styles.modalHeaderHint}>
                Add this to CLAUDE.md in your project, or paste it into each agent session
              </span>
              <button className={styles.modalClose} onClick={() => setShowProtocol(false)} title='Close (Esc)'>
                <XIcon className={styles.modalCloseIcon} />
              </button>
            </div>
            <pre className={styles.modalPre}>{PROTOCOL_MD}</pre>
            <div className={styles.modalActions}>
              <button className={styles.modalCopyBtn} onClick={handleCopyProtocol}>
                {protocolCopied
                  ? <><Check className={styles.modalBtnIcon} /> Copied!</>
                  : <><Copy className={styles.modalBtnIcon} /> Copy to Clipboard</>
                }
              </button>
              <button className={styles.modalDownloadBtn} onClick={handleDownloadProtocol}>
                Download as CLAUDE.md
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Left sidebar ── */}
      <aside className={styles.plansSidebar}>
        <div className={styles.plansSidebarHeader}>
          <Network className={styles.plansSidebarIcon} />
          <span className={styles.plansSidebarTitle}>Conductor</span>
          <button
            className={styles.protocolBtn}
            onClick={() => setShowProtocol(true)}
            title='Show agent protocol instructions (CLAUDE.md)'
          >
            <BookOpen className={styles.newPlanIcon} />
          </button>
          <button className={styles.newPlanBtn} onClick={handleNewPlan} title='New plan'>
            <Plus className={styles.newPlanIcon} />
          </button>
        </div>

        <div className={styles.planList}>
          {draftPlans.length === 0 && (
            <p className={styles.planListEmpty}>No plans yet. Click + to create one.</p>
          )}
          {draftPlans.map(p => (
            <PlanRow
              key={p.id}
              plan={p}
              active={p.id === activePlanId}
              onClick={() => { setActivePlanId(p.id); setTab('build'); }}
              onDelete={() => handleDeletePlan(p.id)}
            />
          ))}
        </div>

        {historyPlans.length > 0 && (
          <>
            <div className={styles.planListSectionLabel}>History</div>
            <div className={styles.planList}>
              {historyPlans.map(p => (
                <PlanRow
                  key={p.id}
                  plan={p}
                  active={p.id === activePlanId}
                  onClick={() => { setActivePlanId(p.id); setTab('history'); }}
                  onDelete={() => handleDeletePlan(p.id)}
                />
              ))}
            </div>
          </>
        )}

        {/* Keyboard shortcut hint */}
        <div className={styles.shortcutsHint}>
          <span className={styles.shortcutKey}>P</span> Pause&nbsp;
          <span className={styles.shortcutKey}>R</span> Resume&nbsp;
          <span className={styles.shortcutKey}>S</span> Stop
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className={styles.main}>

        {/* Tabs */}
        <div className={styles.tabBar}>
          <TabBtn id='build'   active={tab} label='Plan Builder' icon={ClipboardList} onClick={setTab} />
          <TabBtn id='run'     active={tab} label='Pipeline'     icon={GitBranch}     onClick={setTab} />
          <TabBtn id='history' active={tab} label='History'      icon={History}       onClick={setTab} />

          {/* Run controls */}
          {tab === 'run' && liveTasks.length > 0 && (
            <div className={styles.runControls}>
              {engineRunning ? (
                <>
                  <button className={styles.controlBtn} onClick={handlePause} title='Pause (P)'>
                    <Pause className={styles.controlIcon} /> Pause
                  </button>
                  <button className={cx(styles.controlBtn, styles.controlBtnDanger)} onClick={handleStop} title='Stop (S)'>
                    <Square className={styles.controlIcon} /> Stop
                  </button>
                </>
              ) : (
                <>
                  <button className={styles.controlBtn} onClick={handleResume} title='Resume (R)'>
                    <Play className={styles.controlIcon} /> Resume
                  </button>
                  <button
                    className={styles.controlBtn}
                    onClick={() => { setLiveTasks([]); setLogEntries([]); }}
                    title='Clear this run from view'
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Tab content */}
        <div className={styles.content}>

          {/* ── Build tab ── */}
          {tab === 'build' && (
            <div className={styles.buildLayout}>
              {activeWorkspaceId && (
                <SessionRegistry workspaceId={activeWorkspaceId} />
              )}
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
                <div className={styles.placeholder}>
                  <ChevronRight className={styles.placeholderIcon} />
                  <span>Select or create a plan to get started.</span>
                </div>
              )}
            </div>
          )}

          {/* ── Run tab ── */}
          {tab === 'run' && (
            <div className={styles.runLayout}>
              {liveTasks.length > 0 ? (
                <>
                  <PipelineSummary tasks={liveTasks} />
                  <PipelineBoard tasks={liveTasks} sessions={workspaceSessions} agents={agents} />
                  <div className={styles.runBottom}>
                    <div className={styles.logSection}>
                      <div className={styles.sectionLabel}>Orchestrator Log</div>
                      <ConductorLog entries={logEntries} maxHeight={280} />
                    </div>
                    <div className={styles.overrideSection}>
                      <div className={styles.sectionLabel}>Manual Override</div>
                      <ManualOverridePanel
                        tasks={liveTasks}
                        sessions={workspaceSessions}
                        isRunning={engineRunning}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className={styles.placeholder}>
                  <Play className={styles.placeholderIcon} />
                  <span>Approve and run a plan from the Plan Builder tab.</span>
                </div>
              )}
            </div>
          )}

          {/* ── History tab ── */}
          {tab === 'history' && (
            <div className={styles.historyLayout}>
              {historyPlans.length === 0 ? (
                <div className={styles.placeholder}>
                  <History className={styles.placeholderIcon} />
                  <span>No completed plans yet.</span>
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
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft:    'var(--text-tertiary)',
  approved: 'var(--color-brand)',
  running:  'var(--color-brand)',
  paused:   '#f59e0b',
  done:     '#10b981',
  failed:   '#ef4444',
};

// ── PlanRow ───────────────────────────────────────────────────────────────────

const PlanRow: React.FC<{
  plan: OrchestratorPlan;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}> = ({ plan, active, onClick, onDelete }) => {
  const color = STATUS_COLORS[plan.status] ?? 'var(--text-tertiary)';
  return (
    <div className={cx(styles.planRow, active && styles.planRowActive)} onClick={onClick}>
      <div className={styles.planRowDot} style={{ backgroundColor: color }} />
      <span className={styles.planRowLabel}>{plan.goal || 'Untitled plan'}</span>
      <button
        className={styles.planRowDelete}
        onClick={e => { e.stopPropagation(); onDelete(); }}
        title='Delete plan'
      >
        <Trash2 className={styles.planRowDeleteIcon} />
      </button>
    </div>
  );
};

// ── TabBtn ────────────────────────────────────────────────────────────────────

const TabBtn: React.FC<{
  id: Tab; active: Tab; label: string;
  icon: React.ElementType; onClick: (id: Tab) => void;
}> = ({ id, active, label, icon: Icon, onClick }) => (
  <button
    className={cx(styles.tab, active === id && styles.tabActive)}
    onClick={() => onClick(id)}
  >
    <Icon className={styles.tabIcon} />
    {label}
  </button>
);

// ── HistoryCard (expanded detail view) ───────────────────────────────────────

const HistoryCard: React.FC<{
  plan: OrchestratorPlan;
  sessions: ReturnType<typeof Array.prototype.filter>;
  agents: any[];
}> = ({ plan, sessions, agents }) => {
  const [open, setOpen] = useState(false);
  const color = STATUS_COLORS[plan.status] ?? 'var(--text-tertiary)';
  const done  = plan.tasks.filter(t => t.status === 'done').length;
  const total = plan.tasks.length;

  // Duration
  let duration = '';
  if (plan.completedAt && plan.createdAt) {
    const ms = plan.completedAt - plan.createdAt;
    const s  = Math.floor(ms / 1000);
    const m  = Math.floor(s / 60);
    duration = m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  }

  return (
    <div className={styles.histCard}>
      {/* Header row */}
      <div className={styles.histCardHeader} onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer' }}>
        <div className={styles.histCardDot} style={{ backgroundColor: color }} />
        <span className={styles.histCardGoal}>{plan.goal || 'Untitled plan'}</span>
        <span className={styles.histCardStatus} style={{ color }}>{plan.status.toUpperCase()}</span>
        <span className={styles.histCardMeta}>
          {done}/{total} tasks
          {duration && ` · ${duration}`}
          {' · '}{new Date(plan.createdAt).toLocaleDateString()}
        </span>
        {open
          ? <ChevronUp className={styles.histChevron} />
          : <ChevronDown className={styles.histChevron} />
        }
      </div>

      {/* Expanded task detail */}
      {open && (
        <div className={styles.histCardBody}>
          {plan.tasks.length === 0 && (
            <p className={styles.histNoTasks}>No tasks recorded.</p>
          )}
          {plan.tasks.map(task => (
            <div key={task.id} className={styles.histTaskRow}>
              <TaskCard
                task={task}
                allTasks={plan.tasks}
                sessions={sessions}
                agents={agents}
                editable={false}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  root: css`
    display: flex;
    flex-direction: row;
    height: 100%;
    overflow: hidden;
  `,

  // Protocol modal
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

  // Plans sidebar
  plansSidebar: css`
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `,
  plansSidebarHeader: css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-primary);
  `,
  plansSidebarIcon: css`
    width: 14px;
    height: 14px;
    color: var(--color-brand);
    flex-shrink: 0;
  `,
  plansSidebarTitle: css`
    flex: 1;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-primary);
  `,
  protocolBtn: css`
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 3px;
    cursor: pointer;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    transition: color 0.15s, border-color 0.15s;
    &:hover { color: var(--color-brand); border-color: var(--color-brand); }
  `,
  newPlanBtn: css`
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 3px;
    cursor: pointer;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    transition: color 0.15s, border-color 0.15s;
    &:hover { color: var(--color-brand); border-color: var(--color-brand); }
  `,
  newPlanIcon: css`
    width: 12px;
    height: 12px;
  `,
  planList: css`
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 6px;
    gap: 2px;
  `,
  planListEmpty: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-style: italic;
    padding: 4px 6px;
  `,
  planListSectionLabel: css`
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    padding: 8px 12px 4px;
  `,
  planRow: css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    transition: background-color 0.15s;
    &:hover { background-color: var(--bg-hover); }
  `,
  planRowActive: css`
    background-color: var(--bg-hover);
    border-left: 2px solid var(--color-primary);
  `,
  planRowDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  planRowLabel: css`
    flex: 1;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  planRowDelete: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    color: var(--text-tertiary);
    opacity: 0.3;
    display: flex;
    align-items: center;
    transition: opacity 0.15s, color 0.15s;
    &:hover { color: var(--color-danger); opacity: 1; }
  `,
  planRowDeleteIcon: css`
    width: 11px;
    height: 11px;
  `,
  shortcutsHint: css`
    margin-top: auto;
    padding: 8px 14px;
    border-top: 1px solid var(--border-color);
    font-size: 10px;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  `,
  shortcutKey: css`
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: monospace;
    font-size: 10px;
    color: var(--text-secondary);
  `,

  // Main area
  main: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  `,
  tabBar: css`
    display: flex;
    align-items: center;
    gap: 0;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-primary);
    padding: 0 16px;
    flex-shrink: 0;
  `,
  tab: css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    font-size: var(--font-size-xs);
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
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  `,
  runControls: css`
    margin-left: auto;
    display: flex;
    gap: 6px;
    align-items: center;
  `,
  controlBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
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
    width: 12px;
    height: 12px;
  `,
  content: css`
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    min-height: 0;
  `,

  // Build layout
  buildLayout: css`
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 860px;
  `,

  // Run layout
  runLayout: css`
    display: flex;
    flex-direction: column;
    gap: 14px;
  `,
  runBottom: css`
    display: flex;
    gap: 14px;
    align-items: flex-start;
  `,
  logSection: css`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  overrideSection: css`
    width: 300px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  sectionLabel: css`
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-tertiary);
    padding: 0 2px;
  `,

  // History layout
  historyLayout: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 860px;
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
    gap: 8px;
    padding: 12px 14px;
    user-select: none;
    &:hover { background-color: var(--bg-hover); }
  `,
  histCardDot: css`
    width: 8px;
    height: 8px;
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
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.07em;
    flex-shrink: 0;
  `,
  histCardMeta: css`
    font-size: 10px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  `,
  histChevron: css`
    width: 13px;
    height: 13px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  `,
  histCardBody: css`
    border-top: 1px solid var(--border-color);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background-color: var(--bg-primary);
  `,
  histNoTasks: css`
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-style: italic;
  `,
  histTaskRow: css`
    /* TaskCard fills full width */
  `,

  // Placeholder
  placeholder: css`
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    padding: 32px 0;
    justify-content: center;
  `,
  placeholderIcon: css`
    width: 16px;
    height: 16px;
    opacity: 0.4;
  `,
};
