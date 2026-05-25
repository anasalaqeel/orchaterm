import React, { useState, useEffect, useRef, useCallback } from 'react';
import { css, cx } from '@emotion/css';
import { v4 as uuidv4 } from 'uuid';
import { invoke } from '@tauri-apps/api/core';
import { OrchestratorPlan, OrchestratorTask, TerminalSession } from '../../types';
import { bufferWatcher } from '../../services/bufferWatcher';
import { validatePlanJSON, PLAN_START, PLAN_END } from '../../services/sentinelParser';
import { TaskCard } from './TaskCard';
import {
  Plus, PlayCircle, Save, Wand2, Target,
  Loader2, CheckCircle2, XCircle, Copy, Check, X,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type GenStatus = 'idle' | 'sent' | 'waiting' | 'done' | 'error';

interface PlanBuilderProps {
  plan: OrchestratorPlan | null;
  sessions: TerminalSession[];
  workspaceId: string;
  spaceId: string | null;
  onSave: (plan: OrchestratorPlan) => void;
  onApproveAndRun: (plan: OrchestratorPlan) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBlankTask(): OrchestratorTask {
  return {
    id: uuidv4(),
    title: '',
    description: '',
    assignedSessionId: '',
    assignedSessionTitle: '',
    dependsOn: [],
    status: 'pending',
  };
}

function makeBlankPlan(workspaceId: string, spaceId: string | null): OrchestratorPlan {
  return {
    id: uuidv4(),
    goal: '',
    tasks: [makeBlankTask()],
    status: 'draft',
    createdAt: Date.now(),
    workspaceId,
    spaceId,
  };
}

/**
 * Build the full prompt to send to the capable agent for plan generation.
 * Embeds real session IDs so the agent can reference them in its JSON output.
 */
function buildGeneratePrompt(
  goal: string,
  sessions: TerminalSession[],
): string {
  const sessionList = sessions
    .map(s => `  - Session ID: "${s.id}", Terminal: "${s.title}"`)
    .join('\n');

  const exampleId1 = sessions[0]?.id ?? 'session-id-here';
  const exampleId2 = sessions[1]?.id ?? sessions[0]?.id ?? 'session-id-here';

  return `You are acting as an orchestration planner for AgentDeck, a multi-agent coordination system.

GOAL: ${goal || '(fill in your goal)'}

AVAILABLE SESSIONS:
${sessionList || '  (no sessions registered yet)'}

Create a task plan for the goal above. Output ONLY the plan JSON wrapped in the exact markers shown below — no preamble, no explanation outside the markers.

${PLAN_START}
[
  {
    "id": "task-1",
    "title": "Short descriptive task name",
    "description": "Complete instructions for this task, as if written to an agent who has no other context.",
    "assignedSessionId": "${exampleId1}",
    "dependsOn": []
  },
  {
    "id": "task-2",
    "title": "Next task name",
    "description": "Instructions for task 2.",
    "assignedSessionId": "${exampleId2}",
    "dependsOn": ["task-1"]
  }
]
${PLAN_END}

Rules:
- Use ONLY the session IDs listed in AVAILABLE SESSIONS above.
- dependsOn is an array of task IDs that must complete before this task starts. Use [] for tasks with no dependencies.
- Tasks with no shared dependencies can run in parallel (assign them to different sessions).
- Keep descriptions detailed enough that the agent can execute the task without further context.
- Do not include any text before the start marker or after the end marker.`;
}

/**
 * Hydrate validated plan JSON items into full OrchestratorTask objects.
 */
function hydrateTasks(
  items: ReturnType<typeof validatePlanJSON>,
  sessions: TerminalSession[]
): OrchestratorTask[] {
  return items.map(item => {
    const session = sessions.find(s => s.id === item.assignedSessionId);
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      assignedSessionId: item.assignedSessionId,
      assignedSessionTitle: session?.title ?? item.assignedSessionId,
      dependsOn: item.dependsOn,
      status: 'pending',
    };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export const PlanBuilder: React.FC<PlanBuilderProps> = ({
  plan: initialPlan,
  sessions,
  workspaceId,
  spaceId,
  onSave,
  onApproveAndRun,
}) => {
  const [plan, setPlan] = useState<OrchestratorPlan>(
    initialPlan ?? makeBlankPlan(workspaceId, spaceId)
  );

  // Generate-with-Agent state
  const [genSession, setGenSession] = useState('');
  const [genStatus, setGenStatus] = useState<GenStatus>('idle');
  const [genError, setGenError]   = useState('');
  const [genPrompt, setGenPrompt] = useState('');
  const [copied, setCopied]       = useState(false);

  // Keep genPrompt updated when goal or sessions change
  useEffect(() => {
    setGenPrompt(buildGeneratePrompt(plan.goal, sessions));
  }, [plan.goal, sessions]);

  // Cleanup watch on unmount
  const genSessionRef = useRef(genSession);
  genSessionRef.current = genSession;
  useEffect(() => {
    return () => {
      if (genSessionRef.current) {
        bufferWatcher.clearBuffer(genSessionRef.current);
      }
    };
  }, []);

  // ── Mutation helpers ──────────────────────────────────────────────────────────

  const setGoal = (goal: string) => setPlan(p => ({ ...p, goal }));

  const addTask = () => {
    setPlan(p => ({ ...p, tasks: [...p.tasks, makeBlankTask()] }));
  };

  const updateTask = (id: string, patch: Partial<OrchestratorTask>) => {
    setPlan(p => ({
      ...p,
      tasks: p.tasks.map(t => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };

  const deleteTask = (id: string) => {
    setPlan(p => ({
      ...p,
      tasks: p.tasks
        .filter(t => t.id !== id)
        .map(t => ({ ...t, dependsOn: t.dependsOn.filter(dep => dep !== id) })),
    }));
  };

  // ── Validation ────────────────────────────────────────────────────────────────

  const errors: string[] = [];
  if (!plan.goal.trim()) errors.push('Plan goal is required.');
  plan.tasks.forEach((t, i) => {
    if (!t.title.trim()) errors.push(`Task ${i + 1}: title is required.`);
    if (!t.assignedSessionId) errors.push(`Task ${i + 1}: session must be assigned.`);
  });
  const isValid = errors.length === 0;

  // ── Save / Run ────────────────────────────────────────────────────────────────

  const handleSave = () => {
    onSave({ ...plan, status: 'draft' });
  };

  const handleApproveAndRun = useCallback(() => {
    if (!isValid) return;
    onApproveAndRun({ ...plan, status: 'approved' });
  }, [isValid, plan, onApproveAndRun]);

  // Ctrl/Cmd + Enter — approve & run from anywhere in the plan builder
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleApproveAndRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleApproveAndRun]);

  // ── Generate with Agent ───────────────────────────────────────────────────────

  const handleGenerateWithAgent = async () => {
    if (!genSession || !genPrompt.trim()) return;
    if (genStatus === 'waiting') return; // already waiting

    setGenStatus('sent');
    setGenError('');

    try {
      // 1. Set up the plan watcher BEFORE sending the prompt so no early PTY
      //    output is missed during the async listen() setup.
      await bufferWatcher.watchForPlan(
        genSession,
        // onPlan — fires when ###AGENTDECK_PLAN_START### ... ###AGENTDECK_PLAN_END### detected
        (rawJson: string) => {
          try {
            const validated = validatePlanJSON(rawJson);
            const newTasks  = hydrateTasks(validated, sessions);
            setPlan(p => ({ ...p, tasks: newTasks }));
            setGenStatus('done');
          } catch (err: any) {
            setGenStatus('error');
            setGenError(err?.message ?? String(err));
          }
        },
        // onPlanError — fires when markers detected but JSON is invalid
        (err: string) => {
          setGenStatus('error');
          setGenError(err);
        }
      );

      // 2. Now send the prompt — the watcher is already listening.
      await invoke('write_pty', { sessionId: genSession, data: genPrompt + '\n' });
      setGenStatus('waiting');
    } catch (err: any) {
      setGenStatus('error');
      setGenError(err?.message ?? String(err));
    }
  };

  const handleCancelWatch = () => {
    bufferWatcher.clearBuffer(genSession);
    setGenStatus('idle');
    setGenError('');
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(genPrompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>

      {/* ── Goal ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Target className={styles.sectionIcon} />
          <span className={styles.sectionTitle}>Plan Goal</span>
        </div>
        <input
          className={styles.goalInput}
          placeholder='Describe the overall goal of this orchestration plan…'
          value={plan.goal}
          onChange={e => setGoal(e.target.value)}
        />
      </div>

      {/* ── Generate with Agent ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Wand2 className={styles.sectionIcon} />
          <span className={styles.sectionTitle}>Generate Plan with Agent</span>
          <span className={styles.sectionHint}>
            Let a capable agent write the task list
          </span>
        </div>

        {/* Session selector + action buttons */}
        <div className={styles.genRow}>
          <select
            className={styles.select}
            value={genSession}
            onChange={e => { setGenSession(e.target.value); setGenStatus('idle'); setGenError(''); }}
            disabled={genStatus === 'waiting'}
          >
            <option value=''>— Choose session —</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>

          {/* Copy prompt button */}
          <button
            className={styles.copyBtn}
            onClick={handleCopyPrompt}
            title='Copy prompt to clipboard (paste into agent manually)'
          >
            {copied ? <Check className={styles.btnIcon} /> : <Copy className={styles.btnIcon} />}
            {copied ? 'Copied!' : 'Copy prompt'}
          </button>

          {/* Send / Cancel button */}
          {genStatus === 'waiting' ? (
            <button className={styles.cancelBtn} onClick={handleCancelWatch}>
              <X className={styles.btnIcon} />
              Cancel
            </button>
          ) : (
            <button
              className={styles.genBtn}
              onClick={handleGenerateWithAgent}
              disabled={!genSession || !plan.goal.trim() || genStatus === 'sent'}
              title='Send prompt to the selected session and wait for the plan JSON'
            >
              <Wand2 className={styles.btnIcon} />
              {genStatus === 'sent' ? 'Sending…' : 'Generate'}
            </button>
          )}
        </div>

        {/* Status indicator */}
        {genStatus !== 'idle' && (
          <div className={cx(styles.genStatus, styles[`genStatus_${genStatus}`])}>
            {genStatus === 'sent'    && <Loader2 className={cx(styles.genStatusIcon, styles.spin)} />}
            {genStatus === 'waiting' && <Loader2 className={cx(styles.genStatusIcon, styles.spin)} />}
            {genStatus === 'done'    && <CheckCircle2 className={styles.genStatusIcon} />}
            {genStatus === 'error'   && <XCircle className={styles.genStatusIcon} />}
            <span>
              {genStatus === 'sent'    && 'Sending prompt to agent…'}
              {genStatus === 'waiting' && 'Prompt sent — waiting for agent to respond with the plan…'}
              {genStatus === 'done'    && `Plan received! ${plan.tasks.length} tasks loaded — review and edit below.`}
              {genStatus === 'error'   && `Error: ${genError}`}
            </span>
          </div>
        )}

        {/* Editable prompt textarea */}
        <div className={styles.genPromptWrap}>
          <div className={styles.genPromptLabel}>Prompt that will be sent to the agent</div>
          <textarea
            className={styles.genTextarea}
            rows={10}
            value={genPrompt}
            onChange={e => setGenPrompt(e.target.value)}
            disabled={genStatus === 'waiting'}
            spellCheck={false}
          />
        </div>
      </div>

      {/* ── Tasks ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Tasks</span>
          <span className={styles.taskCount}>{plan.tasks.length} task{plan.tasks.length !== 1 ? 's' : ''}</span>
        </div>
        <div className={styles.taskList}>
          {plan.tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              allTasks={plan.tasks}
              sessions={sessions}
              editable
              onChange={patch => updateTask(task.id, patch)}
              onDelete={() => deleteTask(task.id)}
            />
          ))}
        </div>
        <button className={styles.addTaskBtn} onClick={addTask}>
          <Plus className={styles.btnIcon} />
          Add Task
        </button>
      </div>

      {/* ── Validation errors ── */}
      {errors.length > 0 && (
        <ul className={styles.errorList}>
          {errors.map(e => <li key={e}>{e}</li>)}
        </ul>
      )}

      {/* ── Actions ── */}
      <div className={styles.actions}>
        <button className={styles.saveBtn} onClick={handleSave}>
          <Save className={styles.btnIcon} />
          Save Draft
        </button>
        <button
          className={styles.runBtn}
          onClick={handleApproveAndRun}
          disabled={!isValid}
          title={isValid ? 'Approve and start the pipeline' : errors[0]}
        >
          <PlayCircle className={styles.btnIcon} />
          Approve & Run
        </button>
      </div>
    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  root: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  section: css`
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    background-color: var(--bg-secondary);
    overflow: hidden;
  `,
  sectionHeader: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-primary);
  `,
  sectionIcon: css`
    width: 14px;
    height: 14px;
    color: var(--color-brand);
    flex-shrink: 0;
  `,
  sectionTitle: css`
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  `,
  sectionHint: css`
    font-size: 10px;
    color: var(--text-tertiary);
    margin-left: 4px;
  `,
  taskCount: css`
    margin-left: auto;
    font-size: 10px;
    color: var(--text-tertiary);
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    padding: 1px 8px;
  `,
  goalInput: css`
    display: block;
    width: 100%;
    box-sizing: border-box;
    background: transparent;
    border: none;
    padding: 12px 14px;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    font-family: inherit;
    outline: none;

    &::placeholder { color: var(--text-tertiary); }
  `,

  // Generate section
  genRow: css`
    display: flex;
    gap: 8px;
    padding: 12px 14px 0;
    align-items: center;
    flex-wrap: wrap;
  `,
  select: css`
    flex: 1;
    min-width: 160px;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 6px 8px;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s;

    &:focus { border-color: var(--color-brand); }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  `,
  genBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: var(--border-radius-sm);
    background-color: #7c3aed;
    color: #fff;
    font-size: var(--font-size-xs);
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
    white-space: nowrap;

    &:disabled { opacity: 0.4; cursor: not-allowed; }
    &:not(:disabled):hover { opacity: 0.85; }
  `,
  cancelBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: var(--border-radius-sm);
    background-color: var(--bg-primary);
    color: var(--color-danger);
    border: 1px solid var(--color-danger);
    font-size: var(--font-size-xs);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 0.15s;

    &:hover { background-color: rgba(239,68,68,0.08); }
  `,
  copyBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    border-radius: var(--border-radius-sm);
    background-color: var(--bg-primary);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    font-size: var(--font-size-xs);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.15s, color 0.15s;

    &:hover { border-color: var(--color-brand); color: var(--color-brand); }
  `,
  genStatus: css`
    display: flex;
    align-items: flex-start;
    gap: 7px;
    margin: 10px 14px 0;
    padding: 8px 10px;
    border-radius: var(--border-radius-sm);
    border: 1px solid;
    font-size: var(--font-size-xs);
    line-height: 1.4;
  `,
  genStatus_sent: css`
    border-color: var(--border-color);
    color: var(--text-tertiary);
    background-color: var(--bg-primary);
  `,
  genStatus_waiting: css`
    border-color: var(--color-brand);
    color: var(--color-brand);
    background-color: rgba(123, 104, 238, 0.06);
  `,
  genStatus_done: css`
    border-color: var(--color-success);
    color: var(--color-success);
    background-color: rgba(16,185,129,0.06);
  `,
  genStatus_error: css`
    border-color: var(--color-danger);
    color: var(--color-danger);
    background-color: rgba(239,68,68,0.06);
  `,
  genStatusIcon: css`
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    margin-top: 1px;
  `,
  spin: css`
    animation: spin 1.2s linear infinite;

    @keyframes spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
  `,
  genPromptWrap: css`
    margin: 10px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  `,
  genPromptLabel: css`
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
  `,
  genTextarea: css`
    display: block;
    width: 100%;
    box-sizing: border-box;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 10px 12px;
    font-size: 11px;
    color: var(--text-secondary);
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    resize: vertical;
    outline: none;
    line-height: 1.6;
    transition: border-color 0.15s;

    &:focus { border-color: var(--color-brand); }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
    &::placeholder { color: var(--text-tertiary); }
  `,

  // Tasks section
  taskList: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
  `,
  addTaskBtn: css`
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 0 14px 12px;
    padding: 6px 12px;
    border-radius: var(--border-radius-sm);
    background: transparent;
    border: 1px dashed var(--border-color);
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    width: calc(100% - 28px);
    justify-content: center;

    &:hover {
      border-color: var(--color-brand);
      color: var(--color-brand);
    }
  `,

  // Validation errors
  errorList: css`
    margin: 0;
    padding: 10px 14px 10px 28px;
    border: 1px solid var(--color-danger);
    border-radius: var(--border-radius-md);
    background-color: rgba(239, 68, 68, 0.06);
    font-size: var(--font-size-xs);
    color: var(--color-danger);
    display: flex;
    flex-direction: column;
    gap: 3px;
  `,

  // Bottom actions
  actions: css`
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  `,
  saveBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    background-color: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;

    &:hover { background-color: var(--bg-hover); color: var(--text-primary); }
  `,
  runBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    background-color: var(--color-brand);
    color: #fff;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;

    &:disabled { opacity: 0.35; cursor: not-allowed; }
    &:not(:disabled):hover { opacity: 0.85; }
  `,
  btnIcon: css`
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  `,
};
