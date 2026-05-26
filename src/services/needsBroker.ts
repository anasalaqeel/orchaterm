/**
 * needsBroker.ts
 *
 * Handles mid-task help requests from agents. When an agent outputs a
 * ###AGENTDECK_NEEDS### block, the NeedsBroker:
 *  1. Identifies peer agents in the same Space
 *  2. Asks Ollama to synthesise an answer from their recent output
 *  3. Injects the answer back into the requesting terminal (if policy allows)
 *  4. Emits a RoutingEvent so GroupChat can display the exchange
 *
 * This is a singleton service — one instance shared across the app.
 */

import { invoke } from '@tauri-apps/api/core';
import { AgentNeedsRequest, InterruptPolicy, RoutingEvent } from '../types';
import { resolveNeedsRequest, checkOllamaOnline } from './ollamaRelay';
import { bufferWatcher } from './bufferWatcher';
import { canInjectNow } from '../utils/interruptPolicy';

// ── Config ─────────────────────────────────────────────────────────────────────

interface BrokerConfig {
  ollamaHost: string;
  ollamaModel: string;
}

// ── Session descriptor ─────────────────────────────────────────────────────────

export interface BrokerSession {
  id: string;
  title: string;
  color: string | null;
  interruptPolicy: InterruptPolicy;
}

// ── NeedsBroker ────────────────────────────────────────────────────────────────

export class NeedsBroker {
  private config: BrokerConfig = {
    ollamaHost: 'http://localhost:11434',
    ollamaModel: 'llama3.2',
  };

  /** spaceId → sessions in that space */
  private spaces = new Map<string, BrokerSession[]>();

  /** Subscribers that receive routing events (wired to GroupChat). */
  private eventListeners: Array<(event: RoutingEvent) => void> = [];

  updateConfig(config: Partial<BrokerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  registerSpace(spaceId: string, sessions: BrokerSession[]): void {
    this.spaces.set(spaceId, sessions);
  }

  unregisterSpace(spaceId: string): void {
    this.spaces.delete(spaceId);
  }

  onEvent(cb: (event: RoutingEvent) => void): () => void {
    this.eventListeners.push(cb);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== cb);
    };
  }

  /**
   * Called when a NEEDS block is detected in a terminal's buffer.
   * Resolves the request via Ollama and injects the answer if policy allows.
   */
  async handleNeedsRequest(
    requestingSessionId: string,
    spaceId: string,
    request: AgentNeedsRequest,
    onAnswer: (answer: string) => void,
    onError: (err: string) => void,
  ): Promise<void> {
    const sessions = this.spaces.get(spaceId);
    if (!sessions) {
      onError(`Space "${spaceId}" is not registered with NeedsBroker`);
      return;
    }

    const requestingSession = sessions.find(s => s.id === requestingSessionId);
    if (!requestingSession) {
      onError(`Session "${requestingSessionId}" not found in space "${spaceId}"`);
      return;
    }

    const peers = sessions.filter(s => s.id !== requestingSessionId);
    const peerContext = peers.map(s => ({
      title:        s.title,
      // Trim to last 1200 chars to keep Ollama prompt manageable
      recentOutput: bufferWatcher.getBuffer(s.id).slice(-1200),
    }));

    let answer: string;
    try {
      const online = await checkOllamaOnline(this.config.ollamaHost);
      if (!online) throw new Error('Ollama is offline');

      answer = await resolveNeedsRequest({
        ask:             request.ask,
        context:         request.context,
        requestingAgent: requestingSession.title,
        peerContext,
        ollamaHost:      this.config.ollamaHost,
        model:           this.config.ollamaModel,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      onError(msg);
      this.emit({ type: 'needs-failed', requestingAgent: requestingSession.title, error: msg });
      return;
    }

    onAnswer(answer);

    // Inject the answer back into the requesting terminal if policy allows.
    const currentBuffer = bufferWatcher.getBuffer(requestingSessionId);
    if (canInjectNow(currentBuffer, requestingSession.interruptPolicy)) {
      const injection = `\n[AgentDeck answer to your question]: ${answer}\n`;
      await invoke('write_pty', { sessionId: requestingSessionId, data: injection }).catch(() => {});
    }

    this.emit({
      type:            'needs-answered',
      requestingAgent: requestingSession.title,
      question:        request.ask,
      answer,
    });
  }

  private emit(event: RoutingEvent): void {
    for (const cb of this.eventListeners) cb(event);
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const needsBroker = new NeedsBroker();
