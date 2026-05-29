import { bufferWatcher } from './bufferWatcher';
import { buildDetectionPrompt } from './continuationPrompts';
import { generateCheckpoint } from './checkpointGenerator';
import type { LLMProvider } from './llm';
import type { CheckpointSnapshot, ContinuationConfig, DetectionEvent, DetectionLabel } from '../types';

interface SessionMeta {
  id: string;
  title: string;
  workspacePath: string;
  goalHint?: string;
}

interface MonitoredSession {
  meta: SessionMeta;
  config: ContinuationConfig;
  detectionProvider: LLMProvider;
  checkpointProvider: LLMProvider;
  unsubscribeSummary?: () => void;
  unsubscribeIdle?: () => void;
  consecutiveStopCount: number;
  lastPeriodicSnapshotLength: number;
  checkpointInProgress: boolean;
}

export class SessionContinuationService {
  private sessions = new Map<string, MonitoredSession>();
  private eventListeners: Array<(event: DetectionEvent) => void> = [];

  onEvent(cb: (event: DetectionEvent) => void): () => void {
    this.eventListeners.push(cb);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== cb);
    };
  }

  async startMonitoring(
    meta: SessionMeta,
    config: ContinuationConfig,
    detectionProvider: LLMProvider,
    checkpointProvider: LLMProvider,
  ): Promise<void> {
    this.stopMonitoring(meta.id);
    if (!config.enabled) return;

    const entry: MonitoredSession = {
      meta,
      config,
      detectionProvider,
      checkpointProvider,
      consecutiveStopCount: 0,
      lastPeriodicSnapshotLength: 0,
      checkpointInProgress: false,
    };

    const unsubscribeSummary = await bufferWatcher.watchForSummary(
      meta.id,
      (delta) => this.onDelta(meta.id, delta),
    );

    const unsubscribeIdle = await bufferWatcher.watchForIdle(
      meta.id,
      () => this.onIdleShell(meta.id),
    );

    entry.unsubscribeSummary = unsubscribeSummary;
    entry.unsubscribeIdle = unsubscribeIdle;
    this.sessions.set(meta.id, entry);
  }

  stopMonitoring(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.unsubscribeSummary?.();
    entry.unsubscribeIdle?.();
    this.sessions.delete(sessionId);
  }

  isMonitoring(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async captureNow(sessionId: string): Promise<CheckpointSnapshot | null> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    return this.doCheckpoint(entry, 'manual', 'STOPPED');
  }

  private async onDelta(sessionId: string, delta: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.checkpointInProgress) return;

    // Periodic snapshot
    const buffer = bufferWatcher.getBuffer(sessionId);
    const charsSinceLast = buffer.length - entry.lastPeriodicSnapshotLength;
    if (charsSinceLast >= entry.config.snapshotIntervalChars) {
      entry.lastPeriodicSnapshotLength = buffer.length;
      void this.doCheckpoint(entry, 'periodic', 'PROGRESS');
    }

    // Detection
    let label: DetectionLabel = 'PROGRESS';
    try {
      const { system, userContent } = buildDetectionPrompt(delta, entry.meta.title);
      const response = await entry.detectionProvider.complete(
        [{ role: 'user', content: userContent }],
        system,
      );
      const trimmed = response.trim() as DetectionLabel;
      if (['PROGRESS', 'STALLED', 'LIMIT_HIT', 'STOPPED', 'TASK_COMPLETE'].includes(trimmed)) {
        label = trimmed;
      }
    } catch {
      return;
    }

    this.emit({ type: 'detection-update', sessionId, sessionTitle: entry.meta.title, label });

    if (label === 'LIMIT_HIT' || label === 'STOPPED') {
      entry.consecutiveStopCount++;
      if (entry.consecutiveStopCount >= 2) {
        entry.consecutiveStopCount = 0;
        await this.doCheckpoint(entry, 'auto-detection', label);
      }
    } else {
      entry.consecutiveStopCount = 0;
    }
  }

  private async onIdleShell(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.checkpointInProgress) return;
    if (entry.consecutiveStopCount > 0) {
      entry.consecutiveStopCount = 0;
      await this.doCheckpoint(entry, 'auto-detection', 'STOPPED');
    }
  }

  private async doCheckpoint(
    entry: MonitoredSession,
    triggeredBy: CheckpointSnapshot['triggeredBy'],
    label: DetectionLabel,
  ): Promise<CheckpointSnapshot | null> {
    entry.checkpointInProgress = true;
    try {
      const rawBuffer = bufferWatcher.getBuffer(entry.meta.id);
      const snapshot = await generateCheckpoint(
        {
          sessionId: entry.meta.id,
          sessionTitle: entry.meta.title,
          rawBuffer,
          workspacePath: entry.meta.workspacePath,
          triggeredBy,
          label,
          goalHint: entry.meta.goalHint,
        },
        entry.checkpointProvider,
      );
      this.emit({
        type: 'checkpoint-written',
        sessionId: entry.meta.id,
        sessionTitle: entry.meta.title,
        label,
        snapshot,
      });
      return snapshot;
    } catch {
      return null;
    } finally {
      entry.checkpointInProgress = false;
    }
  }

  private emit(event: DetectionEvent): void {
    for (const cb of this.eventListeners) cb(event);
  }
}

export const sessionContinuationService = new SessionContinuationService();
