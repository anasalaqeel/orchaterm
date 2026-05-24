/**
 * bufferWatcher.ts
 *
 * Subscribes to `pty-data-{sessionId}` Tauri events for any number of
 * terminal sessions simultaneously. Accumulates raw output per session and
 * scans for either a task completion sentinel or a plan-generation JSON block,
 * depending on the mode the session is in.
 *
 * Modes per session:
 *   'sentinel' — watches for ###AGENTDECK_DONE### / ###AGENTDECK_END###
 *   'plan'     — watches for ###AGENTDECK_PLAN_START### / ###AGENTDECK_PLAN_END###
 *   'idle'     — listening and accumulating but not triggering callbacks
 *
 * Each session can only be in one mode at a time. Switching modes clears the
 * buffer for that session.
 */

import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { OrchestratorTaskOutput, SessionBuffer, BufferWatchMode } from '../types';
import { parseSentinel, parsePlanBlock, validatePlanJSON } from './sentinelParser';

// ── Internal entry ─────────────────────────────────────────────────────────────

interface WatchEntry {
  buffer: SessionBuffer;
  unlisten: UnlistenFn;
  onSentinel?: (output: OrchestratorTaskOutput) => void;
  onPlan?: (rawJson: string) => void;
  onPlanError?: (err: string) => void;
}

// ── PTY event payload shape emitted by Rust ────────────────────────────────────
interface PtyPayload {
  session_id: string;
  data: string;
}

// ── BufferWatcher ──────────────────────────────────────────────────────────────

class BufferWatcher {
  private entries = new Map<string, WatchEntry>();

  // ── Internal: get or create a listening entry ──────────────────────────────

  private async ensureListening(sessionId: string): Promise<WatchEntry> {
    const existing = this.entries.get(sessionId);
    if (existing) return existing;

    const buffer: SessionBuffer = {
      sessionId,
      buffer: '',
      lastActivity: Date.now(),
      mode: 'idle',
    };

    const unlisten = await listen<PtyPayload>(`pty-data-${sessionId}`, (event) => {
      this.onData(sessionId, event.payload.data);
    });

    const entry: WatchEntry = { buffer, unlisten };
    this.entries.set(sessionId, entry);
    return entry;
  }

  // ── Internal: handle incoming pty-data chunk ───────────────────────────────

  private onData(sessionId: string, chunk: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;

    entry.buffer.buffer += chunk;
    entry.buffer.lastActivity = Date.now();

    switch (entry.buffer.mode) {
      case 'sentinel':
        this.checkSentinel(entry);
        break;
      case 'plan':
        this.checkPlan(entry);
        break;
      case 'idle':
        // Accumulate but don't trigger anything
        break;
    }
  }

  // ── Internal: sentinel check ───────────────────────────────────────────────

  private checkSentinel(entry: WatchEntry): void {
    const result = parseSentinel(entry.buffer.buffer);
    if (!result) return;

    // Snapshot callback and clear before calling to avoid re-entrancy issues
    const cb = entry.onSentinel;
    entry.onSentinel = undefined;
    entry.buffer.mode = 'idle';
    entry.buffer.buffer = '';

    if (cb) cb(result);
  }

  // ── Internal: plan JSON check ──────────────────────────────────────────────

  private checkPlan(entry: WatchEntry): void {
    const rawJson = parsePlanBlock(entry.buffer.buffer);
    if (rawJson === null) return;

    const onPlan  = entry.onPlan;
    const onError = entry.onPlanError;
    entry.onPlan      = undefined;
    entry.onPlanError = undefined;
    entry.buffer.mode = 'idle';
    entry.buffer.buffer = '';

    try {
      validatePlanJSON(rawJson); // throws on invalid
      if (onPlan) onPlan(rawJson);
    } catch (err: any) {
      if (onError) onError(err?.message ?? String(err));
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Switch a session into sentinel-detection mode. Any previous mode and buffer
   * is cleared. The callback fires once when the sentinel is detected.
   */
  async watchForSentinel(
    sessionId: string,
    onSentinel: (output: OrchestratorTaskOutput) => void
  ): Promise<void> {
    const entry = await this.ensureListening(sessionId);
    entry.buffer.buffer = '';
    entry.buffer.mode = 'sentinel';
    entry.onSentinel = onSentinel;
    entry.onPlan = undefined;
    entry.onPlanError = undefined;
  }

  /**
   * Switch a session into plan-detection mode. Any previous mode and buffer
   * is cleared. onPlan fires with the raw JSON string when complete.
   * onPlanError fires if the JSON is malformed.
   */
  async watchForPlan(
    sessionId: string,
    onPlan: (rawJson: string) => void,
    onPlanError: (err: string) => void
  ): Promise<void> {
    const entry = await this.ensureListening(sessionId);
    entry.buffer.buffer = '';
    entry.buffer.mode = 'plan';
    entry.onPlan = onPlan;
    entry.onPlanError = onPlanError;
    entry.onSentinel = undefined;
  }

  /**
   * Stop all callbacks for a session and reset to idle mode.
   * Buffer is cleared. The Tauri event listener stays active so the watcher
   * can be reused for the next task on the same session without re-subscribing.
   */
  clearBuffer(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.buffer.buffer = '';
    entry.buffer.mode = 'idle';
    entry.onSentinel = undefined;
    entry.onPlan = undefined;
    entry.onPlanError = undefined;
  }

  /**
   * Fully stop watching a session. Removes the Tauri event listener.
   * Call when a terminal session is closed.
   */
  unwatch(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.unlisten();
    this.entries.delete(sessionId);
  }

  /**
   * Returns the current raw buffer content for a session (for live display).
   */
  getBuffer(sessionId: string): string {
    return this.entries.get(sessionId)?.buffer.buffer ?? '';
  }

  /**
   * Returns the current watch mode for a session.
   */
  getMode(sessionId: string): BufferWatchMode {
    return this.entries.get(sessionId)?.buffer.mode ?? 'idle';
  }

  /**
   * Returns all currently watched session IDs.
   */
  getWatchedSessions(): string[] {
    return Array.from(this.entries.keys());
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────
// One watcher instance shared across the whole app. This ensures only one
// Tauri event listener per session exists at any time.

export const bufferWatcher = new BufferWatcher();
