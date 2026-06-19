import { LLMProvider, ProviderConfig, ChatMessage, StreamCallbacks } from './types';
import { customFetch as fetch } from './fetch';

const ANTHROPIC_VERSION = '2023-06-01';
// Bound non-streaming completions so a hung server can't stall callers forever.
const COMPLETE_TIMEOUT_MS = 90_000;
const HARDCODED_MODELS = [
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
];

export class AnthropicProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    this.model = config.model;
    this.apiKey = config.apiKey ?? '';
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  async complete(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemPrompt) body.system = systemPrompt;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COMPLETE_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.headers,
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Anthropic error: ${response.status} — ${(err as any)?.error?.message ?? response.statusText}`);
      }
      const data = await response.json();
      const text = (data.content?.[0]?.text ?? '').trim();
      if (!text) throw new Error('Anthropic returned empty response');
      return text;
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new Error('Anthropic request timed out');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  stream(messages: ChatMessage[], systemPrompt: string, callbacks: StreamCallbacks): () => void {
    const { onToken, onDone, onError } = callbacks;
    const controller = new AbortController();
    const body: Record<string, unknown> = {
      model: this.model, max_tokens: 4096, stream: true,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemPrompt) body.system = systemPrompt;

    (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/v1/messages`, {
          method: 'POST', headers: this.headers,
          signal: controller.signal, body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          onError(`Anthropic error ${res.status}: ${(err as any)?.error?.message ?? res.statusText}`);
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) { onError('No response body'); return; }
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data: ')) continue;
            try {
              const obj = JSON.parse(t.slice(6));
              if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
                onToken(obj.delta.text);
              } else if (obj.type === 'message_stop') {
                onDone(); return;
              }
            } catch { /* skip */ }
          }
        }
        onDone();
      } catch (err: any) {
        if (err?.name !== 'AbortError') onError(err?.message ?? 'Connection failed');
      }
    })();

    return () => controller.abort();
  }

  async listModels(): Promise<string[]> {
    return HARDCODED_MODELS;
  }

  async checkOnline(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST', headers: this.headers,
        signal: controller.signal,
        body: JSON.stringify({ model: this.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
      // 4xx means server is reachable (bad key/request), 5xx means server error
      return res.status < 500;
    } catch { return false; }
    finally { clearTimeout(timer); }
  }
}
