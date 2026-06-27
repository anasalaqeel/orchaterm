export type DetectionLabel =
  | 'PROGRESS'
  | 'STALLED'
  | 'LIMIT_HIT'
  | 'STOPPED'
  | 'TASK_COMPLETE';

export type ContinuationMode = 'auto' | 'semi' | 'file-only';

export interface ContinuationConfig {
  enabled: boolean;
  /** Session ID to inject into on detection. null = ask user each time. */
  targetSessionId: string | null;
  mode: ContinuationMode;
  /** Generate a periodic snapshot every N new buffer characters. Default: 4000. */
  snapshotIntervalChars: number;
  /** Maximum character length of the terminal buffer to pass to the LLM. */
  maxContextChars?: number;
}

export interface CheckpointSnapshot {
  id: string;
  sessionId: string;
  sessionTitle: string;
  /** Absolute path to the written .md file. */
  filePath: string;
  triggeredBy: 'auto-detection' | 'manual' | 'periodic';
  label: DetectionLabel;
  createdAt: number;
}

export interface DetectionEvent {
  type: 'checkpoint-written' | 'detection-update';
  sessionId: string;
  sessionTitle: string;
  label: DetectionLabel;
  /** Present only when type === 'checkpoint-written'. */
  snapshot?: CheckpointSnapshot;
}
