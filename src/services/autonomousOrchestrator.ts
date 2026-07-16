/**
 * autonomousOrchestrator.ts
 *
 * Watches all agent terminals in an active Space. When an agent produces
 * significant output, asks Ollama whether that output should be proactively
 * relayed to a peer agent. If yes, and if the target's interrupt policy allows,
 * injects the relay message via write_pty.
 *
 * This is a singleton service — one instance for the whole app.
 *
 * Key design decisions:
 * - Reactive, not polling: triggered by BufferWatcher's summary debounce (800ms)
 * - Skips Conductor-managed sessions: sessions currently in 'sentinel' watch
 *   mode are being managed by the Conductor pipeline — we must not inject into
 *   them unsolicited as that would corrupt the task prompt.
 * - Per-space: each Space has its own autonomous monitoring context. Start/stop
 *   independently.
 */

import { InterruptPolicy, RoutingEvent } from '../types';
import { bufferWatcher } from './bufferWatcher';
import { buildRoutingPrompt } from './orchestratorPrompts';
import { LLMProvider, createProvider } from './llm';
import { canInjectNow } from '../utils/interruptPolicy';
import { writePtyChunked } from '../utils/ptyUtils';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SessionDescriptor {
  id: string;
  title: string;
  color: string | null;
  interruptPolicy: InterruptPolicy;
}

interface SpaceConfig {
  spaceId: string;
  sessions: SessionDescriptor[];
}

interface ActiveSpace {
  config: SpaceConfig;
  /** Unsubscribe functions — one per session summary watcher. */
  unsubscribers: Array<() => void>;
}

// ── AutonomousOrchestrator ─────────────────────────────────────────────────────

export class AutonomousOrchestrator {
  private routingProvider: LLMProvider = createProvider({ provider: 'ollama', model: 'llama3.2' });

  private activeSpaces = new Map<string, ActiveSpace>();
  private eventListeners: Array<(event: RoutingEvent) => void> = [];
  private activeChangeListeners: Array<() => void> = [];

  updateConfig(config: { routingProvider: LLMProvider }): void {
    this.routingProvider = config.routingProvider;
  }

  /** Subscribe to routing events (for GroupChat display). Returns unsubscribe fn. */
  onEvent(cb: (event: RoutingEvent) => void): () => void {
    this.eventListeners.push(cb);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== cb);
    };
  }

  /**
   * Subscribe to changes in the active-session set (a Space starting or
   * stopping). Lets other systems (e.g. session continuation) scope themselves
   * to the sessions actually running agents. Returns an unsubscribe fn.
   */
  onActiveChange(cb: () => void): () => void {
    this.activeChangeListeners.push(cb);
    return () => {
      this.activeChangeListeners = this.activeChangeListeners.filter(l => l !== cb);
    };
  }

  /** Every session id currently under autonomous orchestration, across all spaces. */
  getActiveSessionIds(): string[] {
    const ids: string[] = [];
    for (const active of this.activeSpaces.values()) {
      for (const session of active.config.sessions) ids.push(session.id);
    }
    return ids;
  }

  /** Start autonomous monitoring for a Space. */
  startSpace(spaceConfig: SpaceConfig): void {
    // Stop any existing watchers for this space first (idempotent)
    this.stopSpace(spaceConfig.spaceId);

    const unsubscribers: Array<() => void> = [];

    for (const session of spaceConfig.sessions) {
      const onChunk = async (chunk: string) => {
        await this.onSummaryChunk(spaceConfig.spaceId, session, chunk);
      };
      bufferWatcher.watchForSummary(session.id, onChunk).then(unsub => {
        unsubscribers.push(unsub);
      });
    }

    this.activeSpaces.set(spaceConfig.spaceId, { config: spaceConfig, unsubscribers });
    this.emitActiveChange();
  }

  /** Stop autonomous monitoring for a Space and clean up all watchers. */
  stopSpace(spaceId: string): void {
    const active = this.activeSpaces.get(spaceId);
    if (!active) return;
    for (const unsub of active.unsubscribers) unsub();
    this.activeSpaces.delete(spaceId);
    this.emitActiveChange();
  }

  /** Returns true if autonomous mode is running for the given Space. */
  isRunning(spaceId: string): boolean {
    return this.activeSpaces.has(spaceId);
  }

  private emitActiveChange(): void {
    for (const cb of this.activeChangeListeners) cb();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async onSummaryChunk(
    spaceId: string,
    fromSession: SessionDescriptor,
    chunk: string,
  ): Promise<void> {
    const active = this.activeSpaces.get(spaceId);
    if (!active) return;

    const siblings = active.config.sessions.filter(s => s.id !== fromSession.id);
    if (siblings.length === 0) return;

    let decision: { type: 'no_relay' | 'inject'; targetTitle?: string; message?: string };
    try {
      const { system, userContent } = buildRoutingPrompt(
        fromSession.title,
        chunk,
        siblings.map(s => ({ title: s.title, recentOutput: bufferWatcher.getBuffer(s.id).slice(-600) })),
      );
      const response = await this.routingProvider.complete([{ role: 'user', content: userContent }], system);
      const trimmed = response.trim();

      if (trimmed === 'NO_RELAY' || !trimmed.includes('INJECT')) {
        decision = { type: 'no_relay' };
      } else {
        const match = trimmed.match(/INJECT\s*→\s*([^:\n]+):\s*(.+)/i);
        decision = match
          ? { type: 'inject', targetTitle: match[1].trim(), message: match[2].trim() }
          : { type: 'no_relay' };
      }
    } catch {
      return;
    }

    if (decision.type === 'no_relay' || !decision.targetTitle || !decision.message) return;

    // Find the target session
    const target = siblings.find(
      s => s.title.toLowerCase().includes(decision.targetTitle!.toLowerCase())
    );
    if (!target) return;

    // Respect interrupt policy
    const targetBuffer = bufferWatcher.getBuffer(target.id);
    if (!canInjectNow(targetBuffer, target.interruptPolicy)) {
      this.emit({ type: 'relay-skipped', reason: 'interrupt-policy', target: target.title });
      return;
    }

    const injection = `\n[Orchaterm from ${fromSession.title}]: ${decision.message}\r`;
    await writePtyChunked(target.id, injection).catch(() => {});

    this.emit({ type: 'relayed', from: fromSession.title, to: target.title, message: decision.message });
  }

  private emit(event: RoutingEvent): void {
    for (const cb of this.eventListeners) cb(event);
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const autonomousOrchestrator = new AutonomousOrchestrator();
