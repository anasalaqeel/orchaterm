import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../../services/llm/GeminiProvider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe('GeminiProvider.complete', () => {
  it('calls generateContent with correct URL and returns text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Gemini reply' }] } }],
      }),
    });
    const provider = new GeminiProvider({
      provider: 'gemini', model: 'gemini-1.5-flash', apiKey: 'test-key',
    });
    const result = await provider.complete([{ role: 'user', content: 'Hi' }], 'Be brief');
    expect(result).toBe('Gemini reply');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('gemini-1.5-flash:generateContent');
    expect(url).toContain('key=test-key');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.systemInstruction.parts[0].text).toBe('Be brief');
    expect(body.contents[0].role).toBe('user');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 400, statusText: 'Bad Request',
      json: async () => ({ error: { message: 'Invalid API key' } }),
    });
    const provider = new GeminiProvider({ provider: 'gemini', model: 'gemini-1.5-flash', apiKey: 'bad' });
    await expect(provider.complete([{ role: 'user', content: 'Hi' }])).rejects.toThrow('Invalid API key');
  });
});

describe('GeminiProvider.listModels', () => {
  it('returns model names from /v1beta/models', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    });
    const provider = new GeminiProvider({ provider: 'gemini', model: 'gemini-1.5-flash', apiKey: 'k' });
    const models = await provider.listModels();
    expect(models).toEqual(['gemini-1.5-flash']);   // embedding filtered out
  });

  it('returns [] on error', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    const provider = new GeminiProvider({ provider: 'gemini', model: 'gemini-1.5-flash', apiKey: 'k' });
    const result = await provider.listModels();
    expect(result).toEqual([]);
  });
});
