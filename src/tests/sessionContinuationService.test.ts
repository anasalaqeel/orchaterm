import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionContinuationService } from '../services/sessionContinuationService';

vi.mock('../services/bufferWatcher', () => ({
  bufferWatcher: {
    watchForSummary: vi.fn().mockResolvedValue(() => {}),
    watchForIdle: vi.fn().mockResolvedValue(() => {}),
    getBuffer: vi.fn().mockReturnValue('some terminal output'),
  },
}));

vi.mock('../services/continuationPrompts', () => ({
  buildDetectionPrompt: vi.fn().mockReturnValue({ system: '', userContent: 'detect?' }),
}));

vi.mock('../services/checkpointGenerator', () => ({
  generateCheckpoint: vi.fn().mockResolvedValue({
    id: 'snap-1',
    sessionId: 'sess-a',
    sessionTitle: 'Claude',
    filePath: '/proj/.orchaterm/checkpoints/Claude-ts.md',
    triggeredBy: 'auto-detection',
    label: 'LIMIT_HIT',
    createdAt: Date.now(),
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const mockProvider = {
  complete: vi.fn().mockResolvedValue('PROGRESS'),
  stream: vi.fn(),
  listModels: vi.fn().mockResolvedValue([]),
  checkOnline: vi.fn().mockResolvedValue(true),
};

const defaultConfig = {
  enabled: true,
  targetSessionId: null,
  mode: 'semi' as const,
  snapshotIntervalChars: 4000,
};

const defaultMeta = {
  id: 'sess-a',
  title: 'Claude',
  workspacePath: '/home/user/proj',
};

describe('SessionContinuationService', () => {
  let service: SessionContinuationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SessionContinuationService();
  });

  it('starts monitoring and registers summary + idle watchers', async () => {
    const { bufferWatcher } = await import('../services/bufferWatcher');
    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    expect(bufferWatcher.watchForSummary).toHaveBeenCalledWith('sess-a', expect.any(Function));
    expect(bufferWatcher.watchForIdle).toHaveBeenCalledWith('sess-a', expect.any(Function));
    expect(service.isMonitoring('sess-a')).toBe(true);
  });

  it('stops monitoring and removes session', async () => {
    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    service.stopMonitoring('sess-a');
    expect(service.isMonitoring('sess-a')).toBe(false);
  });

  it('does not start when config.enabled is false', async () => {
    const { bufferWatcher } = await import('../services/bufferWatcher');
    await service.startMonitoring(
      defaultMeta,
      { ...defaultConfig, enabled: false },
      mockProvider,
      mockProvider,
    );
    expect(bufferWatcher.watchForSummary).not.toHaveBeenCalled();
    expect(service.isMonitoring('sess-a')).toBe(false);
  });

  it('calls detection provider when a summary delta arrives', async () => {
    const capturedCallbacks: Array<(chunk: string) => void> = [];
    const { bufferWatcher } = await import('../services/bufferWatcher');
    vi.mocked(bufferWatcher.watchForSummary).mockImplementation(
      async (_id, onChunk) => {
        capturedCallbacks.push(onChunk);
        return () => {};
      }
    );

    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    if (capturedCallbacks[0]) await capturedCallbacks[0]('new output delta');
    expect(mockProvider.complete).toHaveBeenCalled();
  });

  it('emits detection-update event after classification', async () => {
    const capturedCallbacks: Array<(chunk: string) => void> = [];
    const { bufferWatcher } = await import('../services/bufferWatcher');
    vi.mocked(bufferWatcher.watchForSummary).mockImplementation(
      async (_id, onChunk) => { capturedCallbacks.push(onChunk); return () => {}; }
    );

    const events: any[] = [];
    service.onEvent(e => events.push(e));

    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    if (capturedCallbacks[0]) await capturedCallbacks[0]('delta');
    expect(events.some(e => e.type === 'detection-update')).toBe(true);
  });

  it('triggers checkpoint after 2 consecutive LIMIT_HIT classifications', async () => {
    const capturedCallbacks: Array<(chunk: string) => void> = [];
    const { bufferWatcher } = await import('../services/bufferWatcher');
    vi.mocked(bufferWatcher.watchForSummary).mockImplementation(
      async (_id, onChunk) => { capturedCallbacks.push(onChunk); return () => {}; }
    );
    mockProvider.complete.mockResolvedValue('LIMIT_HIT');

    const events: any[] = [];
    service.onEvent(e => events.push(e));

    const { generateCheckpoint } = await import('../services/checkpointGenerator');

    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    const cb = capturedCallbacks[0];
    if (cb) {
      await cb('delta 1');
      await cb('delta 2');
    }
    expect(generateCheckpoint).toHaveBeenCalledTimes(1);
    expect(events.some(e => e.type === 'checkpoint-written')).toBe(true);
  });

  it('does not trigger checkpoint on first LIMIT_HIT (needs 2 consecutive)', async () => {
    const capturedCallbacks: Array<(chunk: string) => void> = [];
    const { bufferWatcher } = await import('../services/bufferWatcher');
    vi.mocked(bufferWatcher.watchForSummary).mockImplementation(
      async (_id, onChunk) => { capturedCallbacks.push(onChunk); return () => {}; }
    );
    mockProvider.complete.mockResolvedValue('LIMIT_HIT');

    const { generateCheckpoint } = await import('../services/checkpointGenerator');

    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    if (capturedCallbacks[0]) await capturedCallbacks[0]('delta 1');
    expect(generateCheckpoint).not.toHaveBeenCalled();
  });

  it('captureNow triggers a manual checkpoint', async () => {
    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);
    const { generateCheckpoint } = await import('../services/checkpointGenerator');
    const snapshot = await service.captureNow('sess-a');
    expect(generateCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ triggeredBy: 'manual', sessionId: 'sess-a' }),
      mockProvider,
    );
    expect(snapshot).not.toBeNull();
  });

  it('triggers checkpoint via idle corroboration when consecutiveStopCount > 0', async () => {
    const summaryCallbacks: Array<(chunk: string) => void> = [];
    let idleCallback: (() => void) | undefined;

    const { bufferWatcher } = await import('../services/bufferWatcher');
    vi.mocked(bufferWatcher.watchForSummary).mockImplementation(
      async (_id, onChunk) => { summaryCallbacks.push(onChunk); return () => {}; }
    );
    vi.mocked(bufferWatcher.watchForIdle).mockImplementation(
      async (_id, onIdle) => { idleCallback = onIdle; return () => {}; }
    );
    mockProvider.complete.mockResolvedValue('LIMIT_HIT');

    const { generateCheckpoint } = await import('../services/checkpointGenerator');

    await service.startMonitoring(defaultMeta, defaultConfig, mockProvider, mockProvider);

    // First LIMIT_HIT delta — raises consecutiveStopCount to 1 (not 2, so no checkpoint yet)
    if (summaryCallbacks[0]) await summaryCallbacks[0]('first delta');
    expect(generateCheckpoint).not.toHaveBeenCalled();

    // Idle shell fires — consecutiveStopCount is 1 (> 0), so trigger immediately
    if (idleCallback) idleCallback();
    // Give the async doCheckpoint a tick to resolve
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(generateCheckpoint).toHaveBeenCalledTimes(1);
  });
});
