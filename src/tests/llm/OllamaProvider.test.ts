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
