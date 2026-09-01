/**
 * orchestratorEngine.ts
 *
 * The central coordination layer. Holds the active plan, runs the dispatcher
 * loop, watches for sentinel signals via BufferWatcher, calls OllamaRelay for
 * handoffs, and exposes a subscription-based API for UI components to react to
 * state and log changes.
 *
 * This is a plain class — no React, no hooks. UI components interact with the
 * singleton instance exported at the bottom of this file.
 *
 * Lifecycle:
 *   engine.start(plan)         → begin orchestration
 *   engine.pause()             → halt dispatching (running tasks continue)
 *   engine.resume()            → re-run dispatcher
 *   engine.failTask(id)        → mark a task failed manually
 *   engine.retryTask(id)       → reset failed task to pending and redispatch
 *   engine.forceCompleteTask() → treat current buffer as task output
 *   engine.injectMessage()     → write directly to a session (user override)
 */

import { writePtyChunked } from '../utils/ptyUtils';
import {
  OrchestratorPlan,
  OrchestratorTask,
  OrchestratorTaskOutput,
  ConductorLogEntry,
} from '../types';
import { bufferWatcher } from './bufferWatcher';
import {
  buildRelayPrompt,
  buildMergeRelayPrompt,
  buildPassThroughBrief,
  buildAutoAnswerPrompt,
  buildCompletionJudgePrompt,
  parseCompletionJudgeResponse,
  buildReplanPrompt,
  parsePlanGenResponse,
  CompletedTaskContext,
  CompletionJudgeVerdict,
} from './orchestratorPrompts';
import { LLMProvider, createProvider } from './llm';
import {
  SENTINEL_START,
  SENTINEL_END,
  NEEDS_START,
  NEEDS_END,
  stripAnsiCodes,
} from './sentinelParser';
import { writeBlackboard, BLACKBOARD_AGENT_INSTRUCTION } from './blackboard';
import { runVerifyCommand } from './verifyRunner';
import { recordAgentEvent, AgentStatEvent } from './agentStats';

// ── Engine configuration ────────────────────────────────────────────────────────

/** Minimum time between soft-completion judge calls for the same task. */
const SOFT_JUDGE_COOLDOWN_MS = 45_000;

/** Max auto-replans per plan run — replanning loops must terminate. */
const MAX_AUTO_REPLANS = 1;

export interface EngineConfig {
  relayProvider: LLMProvider;
  autoAnswerProvider: LLMProvider;
  /** Plans new tasks — used by auto-replan when a failure blocks the plan. */
  plannerProvider: LLMProvider;
  /** Minutes a task can run before being auto-failed. 0 = no timeout. */
  taskTimeoutMinutes: number;
  /** 'auto' = LLM answers prompts. 'manual' = user must INJECT. */
  interactionMode: 'auto' | 'manual';
  /** Maps sessionId → terminal tab title (for display in logs and relay prompts). */
  sessionTitles: Map<string, string>;
  /**
   * Local directory of the workspace the plan runs in. When set, the shared
   * blackboard (ORCHATERM_BOARD.md) is written there after every state change
   * and dispatch prompts point agents at it. Empty = blackboard disabled.
   */
  workspacePath: string;
}

// ── Agent protocol template (injected with every task — no CLAUDE.md needed) ───

function buildAgentProtocol(taskId: string, boardActive: boolean): string {
  return `

---
ORCHATERM PROTOCOL
${boardActive ? `\n${BLACKBOARD_AGENT_INSTRUCTION}\n` : ''}
When this task is fully done, output this block exactly on its own lines:

${SENTINEL_START}
task_id: ${taskId}
summary: <2-3 sentences: what you built, what changed, key decisions>
files_modified: <comma-separated files, or "none">
needs: <what the next agent must know to continue, or "none">
${SENTINEL_END}

Only output this when truly done. Copy task_id exactly as shown above.

If you are blocked mid-task and need info from a peer agent, output this then WAIT:

${NEEDS_START}
ask: <one clear question>
context: <brief description of what you are working on>
${NEEDS_END}

Orchaterm will inject the answer. Use only when genuinely blocked.`;
}

// ── OrchestratorEngine ──────────────────────────────────────────────────────────

export class OrchestratorEngine {
  private plan: OrchestratorPlan | null = null;
  private config: EngineConfig;
  private isPaused = false;

  // timeout handle per taskId
  private taskTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // last soft-completion judge attempt per taskId (rate limiting)
  private softJudgeAt = new Map<string, number>();
  // taskIds with a soft-completion judge call currently in flight
  private softJudgeInFlight = new Set<string>();

  // auto-replan bookkeeping
  private replansUsed = 0;
  private replanInFlight = false;

  // pre-warmed relay briefs per taskId (computed while a ready task waited on
  // a busy session, so dispatch doesn't block on the relay LLM call)
  private relayBriefs = new Map<string, string>();
  private relayPrewarmInFlight = new Set<string>();

  // subscribers
  private stateListeners: Array<(plan: OrchestratorPlan) => void> = [];
  private logListeners: Array<(entry: ConductorLogEntry) => void> = [];

  constructor(config: EngineConfig) {
    this.config = config;
  }

  // ── Configuration update (called when settings change) ─────────────────────

  updateConfig(config: Partial<EngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ── Public: plan lifecycle ──────────────────────────────────────────────────

  start(plan: OrchestratorPlan): void {
    // Block if a plan is actively running or paused — caller must stop() first.
    if (this.plan?.status === 'running' || this.plan?.status === 'paused') {
      this.log('error', 'Cannot start: a plan is already running or paused. Call stop() first.');
      return;
    }
    // Deep-clone so mutations don't escape
    this.plan = {
      ...plan,
      status: 'running',
      tasks: plan.tasks.map((t) => ({ ...t })),
    };
    this.isPaused = false;
    this.replansUsed = 0;
    this.replanInFlight = false;
    this.relayBriefs.clear();
    this.log('info', `Orchestration started — goal: "${plan.goal}"`);
    this.emitState();
    this.dispatchReady();
  }

  pause(): void {
    if (!this.plan || this.plan.status !== 'running') return;
    this.isPaused = true;
    this.mutatePlan({ status: 'paused' });
    this.log('info', 'Orchestration paused');
    this.emitState();
  }

  resume(): void {
    if (!this.plan || this.plan.status !== 'paused') return;
    this.isPaused = false;
    this.mutatePlan({ status: 'running' });
    this.log('info', 'Orchestration resumed');
    this.emitState();
    this.dispatchReady();
  }

  stop(): void {
    if (!this.plan) return;
    // Cancel all timers
    for (const [taskId, timer] of this.taskTimers) {
      clearTimeout(timer);
      this.taskTimers.delete(taskId);
    }
    // Send two Ctrl+C interrupts with a brief delay so stuck/streaming agents stop reliably
    for (const task of this.plan.tasks) {
      if (task.status === 'running') {
        // A user gate is waiting on a chat answer, not on a terminal — nothing
        // to interrupt, so it just goes back to pending for the next run.
        if (task.askUserQuestion) {
          task.status = 'pending';
          continue;
        }
        writePtyChunked(task.assignedSessionId, '\x03')
          .then(() => new Promise((r) => setTimeout(r, 100)))
          .then(() => writePtyChunked(task.assignedSessionId, '\x03\r'))
          .catch(() => {});
        // Reset the watch state but KEEP the pty-data listener — unwatch() would
        // destroy the listener other features (live feed, NEEDS broker, idle
        // detection) depend on for this session.
        bufferWatcher.clearBuffer(task.assignedSessionId);
        // User-initiated stop is not an agent failure — 'cancelled' keeps
        // history honest and keeps the interruption out of reputation stats.
        task.status = 'cancelled';
      }
    }
    this.mutatePlan({ status: 'stopped' });
    this.log('info', 'Orchestration stopped by user');
    this.emitState();
  }

  clearPlan(): void {
    if (!this.plan) return;
    if (this.plan.status === 'running' || this.plan.status === 'paused') {
      this.stop();
    }
    this.plan = null;
    // A future plan must be able to write its board from scratch.
    this.lastBoardSig = undefined;
    this.emitState();
  }

  /** Returns a read-only snapshot of the current plan, or null. */
  getCurrentPlan(): OrchestratorPlan | null {
    return this.plan ? { ...this.plan, tasks: this.plan.tasks.map((t) => ({ ...t })) } : null;
  }

  // ── Public: task overrides ──────────────────────────────────────────────────

  failTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task || task.status === 'done') return;
    this.clearTaskTimer(taskId);
    if (task.status === 'running') {
      bufferWatcher.clearBuffer(task.assignedSessionId);
    }
    this.updateTask(taskId, { status: 'failed' });
    this.stat(task, 'failed');
    this.log('error', `Task "${task.title}" manually marked as failed`, taskId);
    this.emitState();
    this.checkPlanCompletion();
  }

  retryTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task || (task.status !== 'failed' && task.status !== 'cancelled')) return;
    this.updateTask(taskId, {
      status: 'pending',
      startedAt: undefined,
      completedAt: undefined,
      output: undefined,
    });
    this.log('info', `Task "${task.title}" reset for retry`, taskId);
    // Also reset any tasks that were blocked by this failure (downstream pending tasks
    // that depended on this task are already pending — nothing to do for them).
    if (this.plan?.status === 'failed') {
      this.mutatePlan({ status: 'running' });
    }
    this.emitState();
    this.dispatchReady();
  }

  forceCompleteTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'running') return;

    const rawBuffer = bufferWatcher.getBuffer(task.assignedSessionId);
    const output: OrchestratorTaskOutput = {
      raw: rawBuffer,
      taskId,
      summary: '[Force completed by user — no sentinel was output]',
      filesModified: [],
      needs: 'none',
    };

    this.clearTaskTimer(taskId);
    bufferWatcher.clearBuffer(task.assignedSessionId);
    this.updateTask(taskId, { status: 'done', completedAt: Date.now(), output });
    this.log(
      'user-override',
      `Task "${task.title}" force-completed by user`,
      taskId,
      task.assignedSessionId
    );
    this.emitState();
    this.dispatchReady();
    this.checkPlanCompletion();
  }

  /** Injects a raw message into a terminal session, bypassing the orchestrator flow. */
  injectMessage(sessionId: string, message: string): void {
    writePtyChunked(sessionId, message + '\r').catch((err: unknown) =>
      this.log('error', `Manual inject failed: ${err}`, undefined, sessionId)
    );
    this.log(
      'user-override',
      `Manual message injected into session ${sessionId}`,
      undefined,
      sessionId
    );
  }

  /**
   * Resolves a waiting user gate with the user's answer. The answer becomes
   * the task's output (`needs`), so downstream relays hand it to the next
   * agent automatically.
   */
  answerUserGate(taskId: string, answer: string): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'running' || !task.askUserQuestion) return;

    const trimmed = answer.trim();
    if (!trimmed) return;

    const output: OrchestratorTaskOutput = {
      raw: '',
      taskId,
      summary: `User gate answered: ${trimmed}`,
      filesModified: [],
      needs: trimmed,
    };
    this.clearTaskTimer(taskId);
    this.updateTask(taskId, { status: 'done', completedAt: Date.now(), output });
    this.log('user-override', `✅ Gate "${task.title}" answered — continuing`, taskId);
    this.emitState();
    this.dispatchReady();
    this.checkPlanCompletion();
  }

  /**
   * Rewind: resets the given task AND every downstream task that (transitively)
   * depends on it back to pending, then resumes the plan from there. Completed
   * upstream tasks keep their outputs — their relays are reused as-is. Only
   * valid on a failed or stopped plan.
   */
  retryFromTask(taskId: string): void {
    if (!this.plan) return;
    if (this.plan.status !== 'failed' && this.plan.status !== 'stopped') return;
    const start = this.getTask(taskId);
    if (!start) return;

    // Transitive closure of dependents.
    const downstream = new Set<string>([taskId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of this.plan.tasks) {
        if (downstream.has(t.id)) continue;
        if (t.dependsOn.some((dep) => downstream.has(dep))) {
          downstream.add(t.id);
          changed = true;
        }
      }
    }

    for (const id of downstream) {
      this.clearTaskTimer(id);
      this.relayBriefs.delete(id);
      this.updateTask(id, {
        status: 'pending',
        startedAt: undefined,
        completedAt: undefined,
        output: undefined,
      });
    }
    this.isPaused = false;
    this.mutatePlan({ status: 'running', completedAt: undefined });
    this.log(
      'info',
      `⏪ Rewound to "${start.title}" — ${downstream.size} task${downstream.size !== 1 ? 's' : ''} reset, resuming`,
      taskId
    );
    this.emitState();
    this.dispatchReady();
  }

  // ── Public: subscriptions ───────────────────────────────────────────────────

  /** Subscribe to plan state changes. Returns an unsubscribe function. */
  onStateChange(cb: (plan: OrchestratorPlan) => void): () => void {
    this.stateListeners.push(cb);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== cb);
    };
  }

  /** Subscribe to conductor log entries. Returns an unsubscribe function. */
  onLog(cb: (entry: ConductorLogEntry) => void): () => void {
    this.logListeners.push(cb);
    return () => {
      this.logListeners = this.logListeners.filter((l) => l !== cb);
    };
  }

  // ── Private: dispatcher ─────────────────────────────────────────────────────

  private dispatchReady(): void {
    if (!this.plan || this.isPaused || this.plan.status === 'failed' || this.plan.status === 'done')
      return;

    for (const task of this.plan.tasks) {
      if (task.status !== 'pending') continue;

      const allDepsDone = task.dependsOn.every(
        (depId) => this.plan!.tasks.find((t) => t.id === depId)?.status === 'done'
      );
      if (!allDepsDone) continue;

      // One task per session at a time — user gates never touch a terminal, so
      // they must not wait behind (or block) terminal work on their session.
      const sessionBusy =
        !task.askUserQuestion &&
        this.plan.tasks.some(
          (t) => t.assignedSessionId === task.assignedSessionId && t.status === 'running'
        );
      if (sessionBusy) {
        // Ready but waiting on a busy session — start the relay brief now so
        // the LLM call (up to 90s on slow local models) overlaps the wait
        // instead of delaying dispatch on top of it.
        void this.prewarmRelay(task);
        continue;
      }

      // Mark running immediately so concurrent loop iterations or async dispatches see sessionBusy or status !== 'pending'
      this.updateTask(task.id, { status: 'running', startedAt: Date.now() });
      this.emitState();

      // Fire and forget — async dispatch runs independently
      this.dispatch(task);
    }
  }

  // ── Private: relay brief computation ───────────────────────────────────────

  /**
   * Computes the context brief handed to a task from its completed parents:
   * instant pass-through when a single parent declared "needs: none", an LLM
   * relay otherwise, and a deterministic pass-through fallback if the provider
   * fails. Shared by dispatch and the pre-warm path.
   */
  private async buildContextBrief(
    task: OrchestratorTask,
    parentTasks: OrchestratorTask[]
  ): Promise<string> {
    if (!this.plan || parentTasks.length === 0) return '';

    const completedContexts: CompletedTaskContext[] = parentTasks.map((t) => ({
      taskTitle: t.title,
      taskDescription: t.description,
      agentName: this.config.sessionTitles.get(t.assignedSessionId) ?? t.assignedSessionTitle,
      agentBestUsedFor: '',
      output: t.output!,
    }));

    const nextSessionTitle =
      this.config.sessionTitles.get(task.assignedSessionId) ?? task.assignedSessionTitle;

    const allNeedsNoneOrSimple = parentTasks.every(
      (t) => !t.output?.needs || t.output.needs.trim().toLowerCase() === 'none'
    );

    if (allNeedsNoneOrSimple && parentTasks.length === 1) {
      // Skip slow LLM relay when previous task explicitly stated needs: none — pass through instantly (<50ms)!
      const p = parentTasks[0];
      const pAgent = this.config.sessionTitles.get(p.assignedSessionId) ?? p.assignedSessionTitle;
      const brief = `Task "${p.title}" completed by ${pAgent}.\nSummary: ${p.output?.summary || 'Completed as requested.'}\nPrerequisites needed: none.`;
      this.log('relay', `Instant relay (needs: none) for "${task.title}"`, task.id);

      if (p.output) {
        this.updateTask(p.id, { output: { ...p.output, relayedBrief: brief } });
      }
      return brief;
    }

    try {
      const { system, userContent } =
        parentTasks.length === 1
          ? buildRelayPrompt(
              this.plan.goal,
              completedContexts[0],
              task.description,
              nextSessionTitle
            )
          : buildMergeRelayPrompt(
              this.plan.goal,
              completedContexts,
              task.description,
              nextSessionTitle
            );
      const brief = await this.config.relayProvider.complete(
        [{ role: 'user', content: userContent }],
        system
      );

      this.log('relay', `Relay complete for task "${task.title}"`, task.id);

      const lastParent = parentTasks[parentTasks.length - 1];
      if (lastParent.output) {
        this.updateTask(lastParent.id, { output: { ...lastParent.output, relayedBrief: brief } });
      }
      return brief;
    } catch {
      const fallback = buildPassThroughBrief(completedContexts, task.description);
      this.log(
        'info',
        `Provider unavailable — pass-through relay used for "${task.title}"`,
        task.id
      );
      return fallback;
    }
  }

  /** Pre-computes a ready-but-waiting task's relay brief in the background. */
  private async prewarmRelay(task: OrchestratorTask): Promise<void> {
    if (!this.plan || this.relayBriefs.has(task.id) || this.relayPrewarmInFlight.has(task.id))
      return;
    const parentTasks = task.dependsOn
      .map((depId) => this.plan!.tasks.find((t) => t.id === depId))
      .filter((t): t is OrchestratorTask => !!t && !!t.output);
    if (parentTasks.length === 0) return;

    this.relayPrewarmInFlight.add(task.id);
    try {
      const brief = await this.buildContextBrief(task, parentTasks);
      // Task may have been reset/rewound while the brief computed.
      const current = this.getTask(task.id);
      if (current && current.status === 'pending') this.relayBriefs.set(task.id, brief);
    } finally {
      this.relayPrewarmInFlight.delete(task.id);
    }
  }

  // ── Private: dispatch a single task ────────────────────────────────────────

  private async dispatch(task: OrchestratorTask): Promise<void> {
    if (!this.plan) return;

    // User gate: no terminal work — pause and ask in the chat. The task stays
    // 'running' until answerUserGate() resolves it; no PTY watch, no timeout.
    if (task.askUserQuestion) {
      this.log('ask-user', `❓ ${task.askUserQuestion}`, task.id, undefined, undefined);
      this.log(
        'info',
        `Task "${task.title}" is a user gate — pipeline continues when answered.`,
        task.id
      );
      this.emitState();
      return;
    }

    // Collect parent tasks that have output
    const parentTasks: OrchestratorTask[] = task.dependsOn
      .map((depId) => this.plan!.tasks.find((t) => t.id === depId))
      .filter((t): t is OrchestratorTask => !!t && !!t.output);

    let contextBrief: string;

    // A pre-warmed brief (computed while this task waited on a busy session)
    // makes dispatch instant instead of blocking on the relay LLM call.
    const prewarmed = this.relayBriefs.get(task.id);
    if (prewarmed !== undefined) {
      this.relayBriefs.delete(task.id);
      contextBrief = prewarmed;
      this.log('relay', `Relay pre-warmed for "${task.title}"`, task.id);
    } else {
      contextBrief = await this.buildContextBrief(task, parentTasks);
    }

    // Build the full dispatch prompt
    const prompt =
      parentTasks.length > 0
        ? `TASK ID: ${task.id}
AGENT: ${task.assignedSessionTitle}
PROJECT: ${this.plan.goal}

CONTEXT FROM PREVIOUS WORK:
${contextBrief}

YOUR TASK:
${task.description}${buildAgentProtocol(task.id, !!this.config.workspacePath)}`
        : `TASK ID: ${task.id}
AGENT: ${task.assignedSessionTitle}
PROJECT: ${this.plan.goal}

YOUR TASK:
${task.description}${buildAgentProtocol(task.id, !!this.config.workspacePath)}`;

    // Start watching for sentinel before writing prompt so PTY echo is cleanly
    // suppressed. The prompt text anchors echo suppression: the moment its tail
    // comes back, detection starts — output from instant commands is preserved.
    await bufferWatcher.watchForSentinel(task.assignedSessionId, {
      onSentinel: (output) => {
        this.onSentinelReceived(task.id, output);
      },
      onInteractivePrompt: async (promptText) => {
        const shortPrompt = promptText.length > 80 ? promptText.slice(0, 77) + '...' : promptText;

        if (this.config.interactionMode === 'auto') {
          try {
            const { system, userContent } = buildAutoAnswerPrompt(promptText);
            const answer = await this.config.autoAnswerProvider.complete(
              [{ role: 'user', content: userContent }],
              system
            );
            const trimmed = answer.trim().toUpperCase() === 'ENTER' ? '' : answer.trim();

            if (trimmed !== 'UNKNOWN' && answer.trim() !== '') {
              await writePtyChunked(task.assignedSessionId, trimmed + '\r');
              this.log(
                'info',
                `🤖 Auto-answered ("${shortPrompt}") → ${trimmed || '↵'}`,
                task.id,
                task.assignedSessionId
              );
              return;
            }
          } catch (err) {
            this.log(
              'error',
              `Auto-answer provider error: ${err}`,
              task.id,
              task.assignedSessionId
            );
          }
        }

        this.log(
          'user-override',
          `⚠️ ${task.assignedSessionTitle} waiting for input ("${shortPrompt}"). Type INJECT → ${task.assignedSessionTitle}: [your answer] to continue.`,
          task.id,
          task.assignedSessionId
        );
      },
      // Fallback window when the echo anchor never appears (TUI agents).
      echoSuppressMs: 800,
      onAgentIdle: () => this.onAgentIdle(task.id),
      echoText: prompt,
    });

    // Inject into the terminal — '\n' is mandatory to execute
    try {
      await writePtyChunked(task.assignedSessionId, prompt + '\r');
    } catch (err: unknown) {
      // Reset the watch state so the session is not left stuck in sentinel mode.
      bufferWatcher.clearBuffer(task.assignedSessionId);
      this.log(
        'error',
        `Failed to inject task "${task.title}" into session: ${err}`,
        task.id,
        task.assignedSessionId
      );
      this.updateTask(task.id, { status: 'failed' });
      this.stat(task, 'failed');
      this.emitState();
      this.checkPlanCompletion();
      return;
    }

    this.log('dispatch', `Task "${task.title}" dispatched`, task.id, task.assignedSessionId);
    this.emitState();

    // Start timeout timer (0 = disabled)
    if (this.config.taskTimeoutMinutes > 0) {
      const timeoutMs = this.config.taskTimeoutMinutes * 60 * 1000;
      const timer = setTimeout(() => this.onTaskTimeout(task.id), timeoutMs);
      this.taskTimers.set(task.id, timer);
    }
  }

  // ── Private: sentinel received ──────────────────────────────────────────────

  private onSentinelReceived(taskId: string, output: OrchestratorTaskOutput): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'running') return; // guard against duplicates

    this.clearTaskTimer(taskId);
    this.updateTask(taskId, { status: 'done', completedAt: Date.now(), output });
    this.stat(task, 'sentinel-done');
    this.log('sentinel', `Task "${task.title}" complete`, taskId, task.assignedSessionId, {
      taskOutput: output,
      agentTitle: task.assignedSessionTitle,
    });
    void this.runVerification(taskId);
    this.emitState();
    this.dispatchReady();
    this.checkPlanCompletion();
  }

  // ── Private: soft completion (agent idle, no sentinel output) ──────────────

  /**
   * Fired by BufferWatcher when a sentinel-watched terminal returns to a shell
   * prompt after 2s of silence. The agent likely finished without printing the
   * sentinel block (non-compliant agents, plain shell commands), so a small
   * model judges the terminal output against the task's goal before we
   * complete anything. A malformed judge reply is treated as "not done".
   */
  private async onAgentIdle(taskId: string): Promise<void> {
    // One judge call per task at a time — rapid idle/output/idle cycles must
    // not start overlapping evaluations of the same task.
    if (this.softJudgeInFlight.has(taskId)) return;

    const task = this.getTask(taskId);
    if (!task || task.status !== 'running') return;

    const tail = stripAnsiCodes(
      bufferWatcher.getBuffer(task.assignedSessionId).slice(-4000)
    ).trim();
    if (tail.length < 40) return; // nothing meaningful to judge yet

    // Rate-limit actual judge calls (not skipped checks) — an agent that keeps
    // producing output and going quiet again must not trigger one every few
    // seconds. Stamped only once we know a call will be made, so a too-short
    // buffer never burns the cooldown.
    const last = this.softJudgeAt.get(taskId) ?? 0;
    if (Date.now() - last < SOFT_JUDGE_COOLDOWN_MS) return;
    this.softJudgeAt.set(taskId, Date.now());
    this.softJudgeInFlight.add(taskId);

    let verdict: CompletionJudgeVerdict;
    try {
      const { system, userContent } = buildCompletionJudgePrompt(
        task.title,
        task.description,
        tail
      );
      const response = await this.config.autoAnswerProvider.complete(
        [{ role: 'user', content: userContent }],
        system
      );
      verdict = parseCompletionJudgeResponse(response);
    } catch (err) {
      this.log(
        'error',
        `Soft-completion check failed for "${task.title}": ${err}`,
        taskId,
        task.assignedSessionId
      );
      return;
    } finally {
      this.softJudgeInFlight.delete(taskId);
    }

    // The real sentinel may have arrived (or the task may have failed/timed
    // out) while the judge call was in flight — re-check before completing.
    const current = this.getTask(taskId);
    if (!current || current.status !== 'running' || !verdict.complete) return;

    const raw = bufferWatcher.getBuffer(task.assignedSessionId);
    const output: OrchestratorTaskOutput = {
      raw,
      taskId,
      summary: verdict.summary,
      filesModified: [],
      needs: 'none',
    };

    // Reset watch state for this session (mirrors the sentinel path) so the
    // next dispatched task starts from a clean buffer.
    bufferWatcher.clearBuffer(task.assignedSessionId);
    this.clearTaskTimer(taskId);
    this.updateTask(taskId, { status: 'done', completedAt: Date.now(), output });
    this.stat(current, 'soft-done');
    this.log(
      'sentinel',
      `Task "${task.title}" complete (soft completion — no sentinel block was output)`,
      taskId,
      task.assignedSessionId,
      { taskOutput: output, agentTitle: task.assignedSessionTitle }
    );
    void this.runVerification(taskId);
    this.emitState();
    this.dispatchReady();
    this.checkPlanCompletion();
  }

  // ── Private: verification (post-completion receipts) ───────────────────────

  /**
   * Runs the task's verify command in a hidden PTY in the workspace directory
   * and records the result on the task output. A failed verification does NOT
   * fail the task — the agent's claim stands, but the board, logs, and agent
   * stats all show it unverified. Requires workspacePath (the hidden shell
   * must run where the agents' work lives).
   */
  private async runVerification(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'done' || !task.verifyCommand || !task.output) return;
    if (!this.config.workspacePath) {
      this.log(
        'info',
        `Verification skipped for "${task.title}" — no workspace path configured.`,
        taskId
      );
      return;
    }

    const command = task.verifyCommand;
    // The hidden PTY can fail to spawn (e.g. an invalid workspace path). This
    // method is fire-and-forget at its call sites, so it must never reject —
    // log the failure; the task simply stays unverified.
    let result;
    try {
      result = await runVerifyCommand(this.config.workspacePath, command);
    } catch (err) {
      this.log('error', `🧪 Verification could not run for "${task.title}": ${err}`, taskId);
      return;
    }

    // The task may have been reset (rewind) while verification ran.
    const current = this.getTask(taskId);
    if (!current || current.status !== 'done' || !current.output) return;

    this.updateTask(taskId, {
      output: {
        ...current.output,
        verification: { passed: result.passed, command, output: result.output },
      },
    });
    this.stat(current, result.passed ? 'verify-passed' : 'verify-failed');
    this.log(
      result.passed ? 'sentinel' : 'error',
      result.passed
        ? `🧪 Verified "${task.title}" — \`${command}\` passed`
        : `🧪 Verification FAILED for "${task.title}" — \`${command}\` exited non-zero${result.output ? `: ${result.output.slice(-300)}` : ''}`,
      taskId,
      task.assignedSessionId
    );
    this.emitState();
  }

  // ── Private: agent reputation bookkeeping ──────────────────────────────────

  private stat(task: OrchestratorTask, event: AgentStatEvent): void {
    if (!this.plan || !task.assignedSessionId) return;
    recordAgentEvent(
      this.plan.workspaceId,
      task.assignedSessionId,
      task.assignedSessionTitle,
      event
    );
  }

  // ── Private: timeout ────────────────────────────────────────────────────────

  private onTaskTimeout(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'running') return;

    bufferWatcher.clearBuffer(task.assignedSessionId);
    this.updateTask(taskId, { status: 'failed' });
    this.stat(task, 'timed-out');
    this.log(
      'timeout',
      `Task "${task.title}" timed out after ${this.config.taskTimeoutMinutes} minutes. Use "Force Complete" or "Retry".`,
      taskId,
      task.assignedSessionId
    );
    this.emitState();
    this.checkPlanCompletion();
  }

  // ── Private: plan completion check ─────────────────────────────────────────

  private checkPlanCompletion(): void {
    if (!this.plan || this.replanInFlight) return;

    const allDone = this.plan.tasks.every((t) => t.status === 'done');
    const anyRunning = this.plan.tasks.some((t) => t.status === 'running');
    const anyPending = this.plan.tasks.some((t) => t.status === 'pending');

    if (allDone) {
      this.mutatePlan({ status: 'done', completedAt: Date.now() });
      this.log('info', '🎉 All tasks complete. Orchestration finished.');
      this.emitState();
      return;
    }

    // Nothing running and nothing pending → every remaining task is blocked by
    // a failure. Before declaring the plan dead, try one auto-replan.
    if (!anyRunning && !anyPending) {
      const failedTask = this.plan.tasks.find((t) => t.status === 'failed');
      if (failedTask && this.replansUsed < MAX_AUTO_REPLANS && this.plan.status === 'running') {
        void this.attemptReplan(failedTask);
        return;
      }
      this.mutatePlan({ status: 'failed' });
      this.log(
        'error',
        'Orchestration failed — remaining tasks are blocked by failed dependencies. Use "Rewind from task" on the Live board to retry.'
      );
      this.emitState();
    }
  }

  // ── Private: auto-replan ───────────────────────────────────────────────────

  /**
   * Asks the planner for 1-2 replacement tasks for a failed task, splices them
   * into the DAG (inheriting the failed task's upstream deps; downstream tasks
   * are re-pointed onto the replacements), and resumes dispatching. On any
   * planner failure the plan fails exactly as it would have without replanning.
   */
  private async attemptReplan(failedTask: OrchestratorTask): Promise<void> {
    if (!this.plan) return;
    this.replanInFlight = true;
    this.replansUsed++;
    this.log(
      'info',
      `♻️ Task "${failedTask.title}" failed and blocked the plan — asking the planner for a fix…`
    );

    try {
      const failureTail = failedTask.output
        ? stripAnsiCodes(failedTask.output.raw).slice(-1500).trim()
        : '(no output captured — the task timed out or was interrupted)';

      const remaining = this.plan.tasks
        .filter((t) => t.id !== failedTask.id && t.status === 'pending')
        .map((t) => ({
          title: t.title,
          description: t.description,
          agentTitle: t.assignedSessionTitle,
        }));

      const { system, userContent } = buildReplanPrompt(
        this.plan.goal,
        {
          title: failedTask.title,
          description: failedTask.description,
          agentTitle: failedTask.assignedSessionTitle,
          failureTail,
        },
        remaining,
        Array.from(new Set(this.plan.tasks.map((t) => t.assignedSessionTitle)))
      );
      const response = await this.config.plannerProvider.complete(
        [{ role: 'user', content: userContent }],
        system
      );
      const { tasks: rawTasks } = parsePlanGenResponse(response, this.plan.goal);
      if (rawTasks.length === 0) throw new Error('planner returned no tasks');

      if (!this.plan || this.plan.status !== 'running') return; // stopped meanwhile

      // Title→id lookup across existing tasks and the new replacements.
      const idByTitle = new Map<string, string>();
      for (const t of this.plan.tasks) idByTitle.set(t.title.toLowerCase(), t.id);

      // Reverse title lookup for session assignment.
      const sessionByTitle = new Map<string, string>();
      for (const [sid, title] of this.config.sessionTitles)
        sessionByTitle.set(title.toLowerCase(), sid);

      const replacements: OrchestratorTask[] = rawTasks.map((raw) => {
        const id = crypto.randomUUID();
        idByTitle.set(raw.title.toLowerCase(), id);
        return {
          id,
          title: raw.title,
          description: raw.description,
          assignedSessionId:
            sessionByTitle.get(raw.assignedSessionTitle.toLowerCase()) ??
            failedTask.assignedSessionId,
          assignedSessionTitle:
            this.config.sessionTitles.get(
              sessionByTitle.get(raw.assignedSessionTitle.toLowerCase()) ??
                failedTask.assignedSessionId
            ) ?? raw.assignedSessionTitle,
          dependsOn: raw.dependsOn
            .map((depTitle) => idByTitle.get(depTitle.toLowerCase()) ?? '')
            .filter(Boolean),
          status: 'pending' as const,
          verifyCommand:
            typeof raw.verify === 'string' && raw.verify.trim() ? raw.verify.trim() : undefined,
          askUserQuestion:
            typeof raw.askUser === 'string' && raw.askUser.trim() ? raw.askUser.trim() : undefined,
        };
      });
      const replacementIds = replacements.map((r) => r.id);

      // Re-point everything that depended on the failed task onto the
      // replacements (all of them — merge semantics for split replacements).
      const tasks = this.plan.tasks
        .filter((t) => t.id !== failedTask.id)
        .map((t) => ({
          ...t,
          dependsOn: Array.from(
            new Set(t.dependsOn.flatMap((dep) => (dep === failedTask.id ? replacementIds : [dep])))
          ),
        }));

      this.mutatePlan({ tasks: [...tasks, ...replacements] });
      this.log(
        'relay',
        `♻️ Replanned — "${failedTask.title}" replaced with ${replacements.map((r) => `"${r.title}"`).join(' + ')}; downstream re-pointed`
      );
      this.emitState();
      this.dispatchReady();
      this.checkPlanCompletion();
    } catch (err) {
      this.log('error', `Auto-replan failed: ${err}`);
      if (this.plan && this.plan.status === 'running') {
        this.mutatePlan({ status: 'failed' });
        this.log('error', 'Orchestration failed — remaining tasks are blocked.');
      }
      this.emitState();
    } finally {
      this.replanInFlight = false;
    }
  }

  // ── Private: helpers ────────────────────────────────────────────────────────

  private getTask(taskId: string): OrchestratorTask | undefined {
    return this.plan?.tasks.find((t) => t.id === taskId);
  }

  private updateTask(taskId: string, updates: Partial<OrchestratorTask>): void {
    if (!this.plan) return;
    this.plan.tasks = this.plan.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
  }

  private mutatePlan(updates: Partial<OrchestratorPlan>): void {
    if (!this.plan) return;
    this.plan = { ...this.plan, ...updates };
  }

  private clearTaskTimer(taskId: string): void {
    this.softJudgeAt.delete(taskId);
    const timer = this.taskTimers.get(taskId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.taskTimers.delete(taskId);
    }
  }

  private emitState(): void {
    if (!this.plan) return;
    const snapshot: OrchestratorPlan = {
      ...this.plan,
      tasks: this.plan.tasks.map((t) => ({ ...t })),
    };
    for (const cb of this.stateListeners) cb(snapshot);
    this.updateBlackboard();
  }

  // ── Private: shared blackboard ──────────────────────────────────────────────

  /** Signature of the plan state at the last board write (skip identical writes). */
  private lastBoardSig?: string;
  /** Whether the board's location has been announced in the log. */
  private boardPathLogged = false;

  /**
   * Rewrites ORCHATERM_BOARD.md whenever the plan state actually changed. A
   * write failure is logged, never swallowed — agents following the board
   * instruction would otherwise be reading a stale file without anyone knowing.
   */
  private updateBlackboard(): void {
    const plan = this.plan;
    if (!plan || !this.config.workspacePath) return;

    const sig =
      plan.status +
      '|' +
      plan.tasks.map((t) => `${t.id}:${t.status}:${t.output?.summary ?? ''}`).join('|');
    if (sig === this.lastBoardSig) return;
    this.lastBoardSig = sig;

    const announcePath = !this.boardPathLogged;
    writeBlackboard(plan, this.config.workspacePath)
      .then((path) => {
        if (announcePath) {
          this.boardPathLogged = true;
          this.log('info', `📋 Blackboard active: ${path}`);
        }
      })
      .catch((err: unknown) => {
        // Mark as un-announced so a later successful write still reports the path.
        this.log('error', `Blackboard write failed: ${err}`);
      });
  }

  private log(
    type: ConductorLogEntry['type'],
    message: string,
    taskId?: string,
    sessionId?: string,
    extra?: { taskOutput?: ConductorLogEntry['taskOutput']; agentTitle?: string }
  ): void {
    const entry: ConductorLogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type,
      message,
      taskId,
      sessionId,
      // Tag with the running plan's scope so each workspace's GroupChat shows
      // only its own logs (the engine is one global singleton).
      workspaceId: this.plan?.workspaceId,
      spaceId: this.plan?.spaceId,
      ...extra,
    };
    for (const cb of this.logListeners) cb(entry);
  }
}

// ── Singleton export ────────────────────────────────────────────────────────────
// One engine instance for the whole app. Config is updated when settings change.

const _defaultProvider = createProvider({ provider: 'ollama', model: 'llama3.2' });

export const orchestratorEngine = new OrchestratorEngine({
  relayProvider: _defaultProvider,
  plannerProvider: _defaultProvider,
  autoAnswerProvider: _defaultProvider,
  taskTimeoutMinutes: 0,
  interactionMode: 'auto',
  sessionTitles: new Map(),
  workspacePath: '',
});
