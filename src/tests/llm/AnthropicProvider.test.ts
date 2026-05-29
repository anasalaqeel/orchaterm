import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AnthropicProvider } from '../../services/llm/AnthropicProvider';

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

describe('AnthropicProvider.complete', () => {
  it('calls /v1/messages with x-api-key header and returns text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'Claude says hello' }] }),
    });
    const provider = new AnthropicProvider({
      provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant-test',
    });
    const result = await provider.complete([{ role: 'user', content: 'Hi' }], 'Be concise');
    expect(result).toBe('Claude says hello');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-ant-test');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(opts.body);
    expect(body.system).toBe('Be concise');
    expect(body.model).toBe('claude-sonnet-4-6');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized',
      json: async () => ({ error: { message: 'Invalid key' } }),
    });
    const provider = new AnthropicProvider({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    await expect(provider.complete([{ role: 'user', content: 'Hi' }])).rejects.toThrow('Invalid key');
  });
});

describe('AnthropicProvider.listModels', () => {
  it('returns hardcoded model list (no API call needed)', async () => {
    const provider = new AnthropicProvider({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    const models = await provider.listModels();
    expect(models).toContain('claude-sonnet-4-6');
    expect(models).toContain('claude-opus-4-8');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('AnthropicProvider.checkOnline', () => {
  it('returns true when API responds (even 400 = reachable)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 });
    const provider = new AnthropicProvider({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(await provider.checkOnline()).toBe(true);
  });

  it('returns false on 5xx', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const provider = new AnthropicProvider({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(await provider.checkOnline()).toBe(false);
  });

  it('returns false on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = new AnthropicProvider({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    const result = await provider.checkOnline();
    expect(result).toBe(false);
  });
});
