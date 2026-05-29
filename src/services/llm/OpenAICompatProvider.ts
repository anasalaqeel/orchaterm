import { LLMProvider, ProviderConfig, ChatMessage, StreamCallbacks } from './types';
import { customFetch as fetch } from './fetch';

export class OpenAICompatProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl || 'https://api.openai.com').replace(/\/$/, '');
    this.model = config.model;
    this.apiKey = config.apiKey ?? '';
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async complete(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const allMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ model: this.model, messages: allMessages, stream: false }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`API error: ${response.status} — ${(err as any)?.error?.message ?? response.statusText}`);
    }
    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new Error('API returned empty response');
    return text;
  }

  stream(messages: ChatMessage[], systemPrompt: string, callbacks: StreamCallbacks): () => void {
    const { onToken, onDone, onError } = callbacks;
    const controller = new AbortController();
    const allMessages = [{ role: 'system', content: systemPrompt }, ...messages];

    (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: this.headers,
          signal: controller.signal,
          body: JSON.stringify({ model: this.model, messages: allMessages, stream: true }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          onError(`API error ${res.status}: ${(err as any)?.error?.message ?? res.statusText}`);
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
            const payload = t.slice(6);
            if (payload === '[DONE]') { onDone(); return; }
            try {
              const obj = JSON.parse(payload);
              const delta = obj.choices?.[0]?.delta?.content;
              if (delta) onToken(delta);
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
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, { headers: this.headers });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data ?? []).map((m: { id: string }) => m.id).sort();
    } catch { return []; }
  }

  async checkOnline(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, { headers: this.headers });
      return res.ok;
    } catch { return false; }
  }
}
