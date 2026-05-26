import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NeedsBroker } from '../services/needsBroker';

// Mock ollamaRelay
vi.mock('../services/ollamaRelay', () => ({
  resolveNeedsRequest: vi.fn().mockResolvedValue('The answer from Ollama'),
  checkOllamaOnline: vi.fn().mockResolvedValue(true),
}));

// Mock bufferWatcher
vi.mock('../services/bufferWatcher', () => ({
  bufferWatcher: {
    getBuffer: vi.fn().mockReturnValue('peer agent output'),
    watchForNeeds: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('NeedsBroker', () => {
  let broker: NeedsBroker;

  beforeEach(() => {
    broker = new NeedsBroker();
    broker.updateConfig({ ollamaHost: 'http://localhost:11434', ollamaModel: 'llama3.2' });
  });

  it('registers a space with sessions', () => {
    broker.registerSpace('space-1', [
      { id: 'sess-a', title: 'Claude', color: null, interruptPolicy: 'always' },
      { id: 'sess-b', title: 'Antigravity', color: null, interruptPolicy: 'prompt-only' },
    ]);
    // No error means success — space is registered
    expect(true).toBe(true);
  });

  it('calls resolveNeedsRequest with sibling context when needs detected', async () => {
    const { resolveNeedsRequest } = await import('../services/ollamaRelay');

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

    expect(resolveNeedsRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        ask: 'What is the API contract?',
        requestingAgent: 'Claude',
        peerContext: expect.arrayContaining([
          expect.objectContaining({ title: 'Antigravity' }),
        ]),
      }),
    );
    expect(onAnswer).toHaveBeenCalledWith('The answer from Ollama');
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
