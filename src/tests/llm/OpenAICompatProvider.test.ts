import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OpenAICompatProvider } from '../../services/llm/OpenAICompatProvider';

const mockFetch = vi.fn();
beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

describe('OpenAICompatProvider.complete', () => {
  it('calls /v1/chat/completions and returns choice content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Answer' } }] }),
    });
    const provider = new OpenAICompatProvider({
      provider: 'openai-compatible', model: 'gpt-4o',
      baseUrl: 'https://api.openai.com', apiKey: 'sk-test',
    });
    const result = await provider.complete([{ role: 'user', content: 'Hi' }], 'Be helpful');
    expect(result).toBe('Answer');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers['Authorization']).toBe('Bearer sk-test');
    const body = JSON.parse(opts.body);
    expect(body.stream).toBe(false);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Be helpful' });
  });

  it('works without apiKey (LM Studio)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'OK' } }] }),
    });
    const provider = new OpenAICompatProvider({
      provider: 'openai-compatible', model: 'llama3', baseUrl: 'http://localhost:1234',
    });
    await provider.complete([{ role: 'user', content: 'Hi' }]);
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized',
      json: async () => ({ error: { message: 'Invalid API key' } }),
    });
    const provider = new OpenAICompatProvider({ provider: 'openai-compatible', model: 'gpt-4o' });
    await expect(provider.complete([{ role: 'user', content: 'Hi' }])).rejects.toThrow('Invalid API key');
  });
});

describe('OpenAICompatProvider.listModels', () => {
  it('returns model IDs from /v1/models', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }),
    });
    const provider = new OpenAICompatProvider({ provider: 'openai-compatible', model: 'gpt-4o' });
    expect(await provider.listModels()).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('rejects on error so the UI can surface the reason', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    const provider = new OpenAICompatProvider({ provider: 'openai-compatible', model: 'gpt-4o' });
    await expect(provider.listModels()).rejects.toThrow('timeout');
  });
});
