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

import { invoke } from '@tauri-apps/api/core';
import {
  OrchestratorPlan,
  OrchestratorTask,
  OrchestratorTaskOutput,
  ConductorLogEntry,
} from '../types';
import { bufferWatcher } from './bufferWatcher';
import {
  relayViaOllama,
  mergeAndRelayViaOllama,
  buildPassThroughBrief,
  checkOllamaOnline,
  CompletedTaskContext,
} from './ollamaRelay';
import { SENTINEL_START, SENTINEL_END, NEEDS_START, NEEDS_END } from './sentinelParser';

// ── Engine configuration ────────────────────────────────────────────────────────

export interface EngineConfig {
  ollamaHost: string;
  ollamaModel: string;
  /** Minutes a task can run before being auto-failed. */
  taskTimeoutMinutes: number;
  /** Maps sessionId → terminal tab title (for display in logs and relay prompts). */
  sessionTitles: Map<string, string>;
}

// ── Agent protocol template (injected with every task — no CLAUDE.md needed) ───

function buildAgentProtocol(taskId: string): string {
  return `

---
AGENTDECK PROTOCOL

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

AgentDeck will inject the answer. Use only when genuinely blocked.`;
}

// ── OrchestratorEngine ──────────────────────────────────────────────────────────

export class OrchestratorEngine {
  private plan: OrchestratorPlan | null = null;
  private config: EngineConfig;
  private isPaused = false;

  // timeout handle per taskId
  private taskTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // subscribers
  private stateListeners: Array<(plan: OrchestratorPlan) => void> = [];
  private logListeners:   Array<(entry: ConductorLogEntry) => void> = [];

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
      tasks: plan.tasks.map(t => ({ ...t })),
    };
    this.isPaused = false;
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
    // Fully unwatch all running task sessions so their Tauri listeners are
    // removed. Using unwatch() (not clearBuffer()) ensures the listeners are
    // torn down and don't accumulate if the engine is stopped and restarted.
    for (const task of this.plan.tasks) {
      if (task.status === 'running') {
        bufferWatcher.unwatch(task.assignedSessionId);
      }
    }
    this.mutatePlan({ status: 'failed' });
    this.log('info', 'Orchestration stopped by user');
    this.emitState();
    this.plan = null;
  }

  /** Returns a read-only snapshot of the current plan, or null. */
  getCurrentPlan(): OrchestratorPlan | null {
    return this.plan ? { ...this.plan, tasks: this.plan.tasks.map(t => ({ ...t })) } : null;
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
    this.log('error', `Task "${task.title}" manually marked as failed`, taskId);
    this.emitState();
    this.checkPlanCompletion();
  }

  retryTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'failed') return;
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
    this.log('user-override', `Task "${task.title}" force-completed by user`, taskId, task.assignedSessionId);
    this.emitState();
    this.dispatchReady();
    this.checkPlanCompletion();
  }

  /** Injects a raw message into a terminal session, bypassing the orchestrator flow. */
  injectMessage(sessionId: string, message: string): void {
    invoke('write_pty', { sessionId, data: message + '\n' })
      .catch((err: unknown) => this.log('error', `Manual inject failed: ${err}`, undefined, sessionId));
    this.log('user-override', `Manual message injected into session ${sessionId}`, undefined, sessionId);
  }

  // ── Public: subscriptions ───────────────────────────────────────────────────

  /** Subscribe to plan state changes. Returns an unsubscribe function. */
  onStateChange(cb: (plan: OrchestratorPlan) => void): () => void {
    this.stateListeners.push(cb);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== cb);
    };
  }

  /** Subscribe to conductor log entries. Returns an unsubscribe function. */
  onLog(cb: (entry: ConductorLogEntry) => void): () => void {
    this.logListeners.push(cb);
    return () => {
      this.logListeners = this.logListeners.filter(l => l !== cb);
    };
  }

  // ── Private: dispatcher ─────────────────────────────────────────────────────

  private dispatchReady(): void {
    if (!this.plan || this.isPaused || this.plan.status === 'failed' || this.plan.status === 'done') return;

    for (const task of this.plan.tasks) {
      if (task.status !== 'pending') continue;

      const allDepsDone = task.dependsOn.every(depId =>
        this.plan!.tasks.find(t => t.id === depId)?.status === 'done'
      );
      if (!allDepsDone) continue;

      // One task per session at a time
      const sessionBusy = this.plan.tasks.some(
        t => t.assignedSessionId === task.assignedSessionId && t.status === 'running'
      );
      if (sessionBusy) continue;

      // Fire and forget — async dispatch runs independently
      this.dispatch(task);
    }
  }

  // ── Private: dispatch a single task ────────────────────────────────────────

  private async dispatch(task: OrchestratorTask): Promise<void> {
    if (!this.plan) return;

    // Collect parent tasks that have output
    const parentTasks: OrchestratorTask[] = task.dependsOn
      .map(depId => this.plan!.tasks.find(t => t.id === depId))
      .filter((t): t is OrchestratorTask => !!t && !!t.output);

    let contextBrief = '';

    if (parentTasks.length > 0) {
      const completedContexts: CompletedTaskContext[] = parentTasks.map(t => ({
        taskTitle:          t.title,
        taskDescription:    t.description,
        agentName:          this.config.sessionTitles.get(t.assignedSessionId) ?? t.assignedSessionTitle,
        agentBestUsedFor:   '',
        output:             t.output!,
      }));

      const nextSessionTitle = this.config.sessionTitles.get(task.assignedSessionId) ?? task.assignedSessionTitle;

      try {
        const ollamaOnline = await checkOllamaOnline(this.config.ollamaHost);

        if (!ollamaOnline) throw new Error('Ollama offline');

        if (parentTasks.length === 1) {
          contextBrief = await relayViaOllama({
            goal:                   this.plan.goal,
            completedTask:          completedContexts[0],
            nextTaskDescription:    task.description,
            nextAgentName:          nextSessionTitle,
            nextAgentBestUsedFor:   '',
            ollamaHost:             this.config.ollamaHost,
            model:                  this.config.ollamaModel,
          });
        } else {
          contextBrief = await mergeAndRelayViaOllama({
            goal:                   this.plan.goal,
            completedTasks:         completedContexts,
            nextTaskDescription:    task.description,
            nextAgentName:          nextSessionTitle,
            nextAgentBestUsedFor:   '',
            ollamaHost:             this.config.ollamaHost,
            model:                  this.config.ollamaModel,
          });
        }

        this.log('relay', `Ollama relay complete for task "${task.title}"`, task.id);

        // Store the brief on the last parent's output for display in the conductor log
        const lastParent = parentTasks[parentTasks.length - 1];
        if (lastParent.output) {
          this.updateTask(lastParent.id, {
            output: { ...lastParent.output, relayedBrief: contextBrief },
          });
        }

      } catch {
        // Ollama offline or failed — use pass-through
        contextBrief = buildPassThroughBrief(completedContexts, task.description);
        this.log('info', `Ollama unavailable — pass-through relay used for "${task.title}"`, task.id);
      }
    }

    // Build the full dispatch prompt
    const prompt = parentTasks.length > 0
      ? `TASK ID: ${task.id}
OVERALL GOAL: ${this.plan.goal}

CONTEXT FROM PREVIOUS WORK:
${contextBrief}

YOUR TASK:
${task.description}${buildAgentProtocol(task.id)}`
      : `TASK ID: ${task.id}
OVERALL GOAL: ${this.plan.goal}

YOUR TASK:
${task.description}${buildAgentProtocol(task.id)}`;

    // Inject into the terminal — '\n' is mandatory to execute
    try {
      await invoke('write_pty', { sessionId: task.assignedSessionId, data: prompt + '\n' });
    } catch (err: unknown) {
      this.log('error', `Failed to inject task "${task.title}" into session: ${err}`, task.id, task.assignedSessionId);
      this.updateTask(task.id, { status: 'failed' });
      this.emitState();
      this.checkPlanCompletion();
      return;
    }

    this.updateTask(task.id, { status: 'running', startedAt: Date.now() });
    this.log('dispatch', `Task "${task.title}" dispatched`, task.id, task.assignedSessionId);
    this.emitState();

    // Start watching for the sentinel. Must be awaited so the listener is
    // registered before any PTY data can arrive — without await, a fast agent
    // could emit the sentinel before the listener is active.
    await bufferWatcher.watchForSentinel(task.assignedSessionId, (output) => {
      this.onSentinelReceived(task.id, output);
    });

    // Start timeout timer
    const timeoutMs = this.config.taskTimeoutMinutes * 60 * 1000;
    const timer = setTimeout(() => this.onTaskTimeout(task.id), timeoutMs);
    this.taskTimers.set(task.id, timer);
  }

  // ── Private: sentinel received ──────────────────────────────────────────────

  private onSentinelReceived(taskId: string, output: OrchestratorTaskOutput): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'running') return; // guard against duplicates

    this.clearTaskTimer(taskId);
    this.updateTask(taskId, { status: 'done', completedAt: Date.now(), output });
    this.log('sentinel', `Task "${task.title}" complete — ${output.summary}`, taskId, task.assignedSessionId);
    this.emitState();
    this.dispatchReady();
    this.checkPlanCompletion();
  }

  // ── Private: timeout ────────────────────────────────────────────────────────

  private onTaskTimeout(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'running') return;

    bufferWatcher.clearBuffer(task.assignedSessionId);
    this.updateTask(taskId, { status: 'failed' });
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
    if (!this.plan) return;

    const allDone    = this.plan.tasks.every(t => t.status === 'done');
    const anyRunning = this.plan.tasks.some(t => t.status === 'running');
    const anyPending = this.plan.tasks.some(t => t.status === 'pending');

    if (allDone) {
      this.mutatePlan({ status: 'done', completedAt: Date.now() });
      this.log('info', '🎉 All tasks complete. Orchestration finished.');
      this.emitState();
      return;
    }

    // If nothing is running and nothing can run (all blocked by failures)
    if (!anyRunning && !anyPending) {
      this.mutatePlan({ status: 'failed' });
      this.log('error', 'Orchestration failed — remaining tasks are blocked by failed dependencies.');
      this.emitState();
    }
  }

  // ── Private: helpers ────────────────────────────────────────────────────────

  private getTask(taskId: string): OrchestratorTask | undefined {
    return this.plan?.tasks.find(t => t.id === taskId);
  }

  private updateTask(taskId: string, updates: Partial<OrchestratorTask>): void {
    if (!this.plan) return;
    this.plan.tasks = this.plan.tasks.map(t =>
      t.id === taskId ? { ...t, ...updates } : t
    );
  }

  private mutatePlan(updates: Partial<OrchestratorPlan>): void {
    if (!this.plan) return;
    this.plan = { ...this.plan, ...updates };
  }

  private clearTaskTimer(taskId: string): void {
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
      tasks: this.plan.tasks.map(t => ({ ...t })),
    };
    for (const cb of this.stateListeners) cb(snapshot);
  }

  private log(
    type: ConductorLogEntry['type'],
    message: string,
    taskId?: string,
    sessionId?: string
  ): void {
    const entry: ConductorLogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type,
      message,
      taskId,
      sessionId,
    };
    for (const cb of this.logListeners) cb(entry);
  }
}

// ── Singleton export ────────────────────────────────────────────────────────────
// One engine instance for the whole app. Config is updated when settings change.

export const orchestratorEngine = new OrchestratorEngine({
  ollamaHost: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  taskTimeoutMinutes: 30,
  sessionTitles: new Map(),
});
