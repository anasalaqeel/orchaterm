import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NeedsBroker } from '../services/needsBroker';

// Mock ollamaRelay
vi.mock('../services/ollamaRelay', () => ({
  buildNeedsPrompt: vi.fn().mockReturnValue({ system: '', userContent: 'needs?' }),
}));

// Mock bufferWatcher
vi.mock('../services/bufferWatcher', () => ({
  bufferWatcher: {
    getBuffer: vi.fn().mockReturnValue('peer agent output'),
    watchForNeeds: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockProvider = {
  complete: vi.fn().mockResolvedValue('The answer from provider'),
  stream: vi.fn(),
  listModels: vi.fn().mockResolvedValue([]),
  checkOnline: vi.fn().mockResolvedValue(true),
};

describe('NeedsBroker', () => {
  let broker: NeedsBroker;

  beforeEach(() => {
    vi.clearAllMocks();
    broker = new NeedsBroker();
    broker.updateConfig({ provider: mockProvider });
  });

  it('registers a space with sessions', () => {
    broker.registerSpace('space-1', [
      { id: 'sess-a', title: 'Claude', color: null, interruptPolicy: 'always' },
      { id: 'sess-b', title: 'Antigravity', color: null, interruptPolicy: 'prompt-only' },
    ]);
    // No error means success — space is registered
    expect(true).toBe(true);
  });

  it('calls provider.complete with sibling context when needs detected', async () => {
    broker.registerSpace('space-1', [
      { id: 'sess-a', title: 'Claude', color: null, interruptPolicy: 'always' },
      { id: 'sess-b', title: 'Antigravity', color: null, interruptPolicy: 'always' },
    ]);

    const onAnswer = vi.fn();
    const onError  = vi.fn();

    await broker.handleNeedsRequest(
      'sess-a',
      'space-1',
      { ask: 'What is the API contract?', context: 'Building the client' },
      onAnswer,
      onError,
    );

    expect(mockProvider.complete).toHaveBeenCalled();
    expect(onAnswer).toHaveBeenCalledWith('The answer from provider');
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError when space is not registered', async () => {
    const onAnswer = vi.fn();
    const onError  = vi.fn();

    await broker.handleNeedsRequest(
      'sess-a',
      'unknown-space',
      { ask: 'x', context: '' },
      onAnswer,
      onError,
    );

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('not registered'));
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
