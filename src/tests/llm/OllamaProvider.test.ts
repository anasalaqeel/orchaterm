import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OllamaProvider } from '../../services/llm/OllamaProvider';

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

describe('OllamaProvider.complete', () => {
  it('calls /api/chat and returns message content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'Hello world' } }),
    });

    const provider = new OllamaProvider({ provider: 'ollama', model: 'llama3.2', baseUrl: 'http://localhost:11434' });
    const result = await provider.complete([{ role: 'user', content: 'Hi' }], 'You are helpful');

    expect(result).toBe('Hello world');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('llama3.2');
    expect(body.stream).toBe(false);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
  });

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const provider = new OllamaProvider({ provider: 'ollama', model: 'llama3.2' });
    await expect(provider.complete([{ role: 'user', content: 'Hi' }])).rejects.toThrow('Ollama error: 500');
  });

  it('throws when response content is empty', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ message: { content: '' } }) });
    const provider = new OllamaProvider({ provider: 'ollama', model: 'llama3.2' });
    await expect(provider.complete([{ role: 'user', content: 'Hi' }])).rejects.toThrow('empty response');
  });
});

describe('OllamaProvider.checkOnline', () => {
  it('returns true when /api/tags responds ok', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const provider = new OllamaProvider({ provider: 'ollama', model: 'llama3.2' });
    expect(await provider.checkOnline()).toBe(true);
  });

  it('returns false when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = new OllamaProvider({ provider: 'ollama', model: 'llama3.2' });
    expect(await provider.checkOnline()).toBe(false);
  });
});

describe('OllamaProvider.listModels', () => {
  it('returns model names from /api/tags', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2' }, { name: 'mistral' }] }),
    });
    const provider = new OllamaProvider({ provider: 'ollama', model: 'llama3.2' });
    expect(await provider.listModels()).toEqual(['llama3.2', 'mistral']);
  });

  it('returns [] on network error', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    const provider = new OllamaProvider({ provider: 'ollama', model: 'llama3.2' });
    expect(await provider.listModels()).toEqual([]);
  });
});

describe('OllamaProvider.complete timeout', () => {
  it('aborts and throws when the server hangs past the timeout', async () => {
    vi.useFakeTimers();
    // Hang until the AbortController fires, then reject like a real aborted fetch.
    mockFetch.mockImplementation((_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
    );

    const provider = new OllamaProvider({ provider: 'ollama', model: 'llama3.2' });
    const p = provider.complete([{ role: 'user', content: 'Hi' }]);
    // Attach the rejection handler BEFORE advancing timers, otherwise the
    // rejection fires with no handler attached → unhandled-rejection noise.
    const assertion = expect(p).rejects.toThrow('Ollama request timed out');

    await vi.advanceTimersByTimeAsync(90_000);
    await assertion;

    vi.useRealTimers();
  });
});

describe('OllamaProvider.stream', () => {
  // Builds a Response-like object whose body reader yields the given string chunks.
  function streamResponse(chunks: string[]) {
    const enc = new TextEncoder();
    let i = 0;
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () =>
            i < chunks.length
              ? { done: false, value: enc.encode(chunks[i++]) }
              : { done: true, value: undefined },
        }),
      },
    };
  }

  it('reassembles a JSON line split across two reads (no dropped tokens)', async () => {
    mockFetch.mockResolvedValue(
      streamResponse([
        '{"message":{"content":"Hel',                                            // line split mid-token
        'lo "},"done":false}\n{"message":{"content":"world"},"done":true}\n',
      ]),
    );

    const provider = new OllamaProvider({ provider: 'ollama', model: 'llama3.2' });
    const tokens: string[] = [];
    await new Promise<void>((resolve, reject) => {
      provider.stream([{ role: 'user', content: 'Hi' }], 'sys', {
        onToken: (t) => tokens.push(t),
        onDone: () => resolve(),
        onError: (e) => reject(new Error(e)),
      });
    });

    expect(tokens.join('')).toBe('Hello world');
  });
});
