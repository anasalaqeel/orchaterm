import { LLMProvider, ProviderConfig, ChatMessage, StreamCallbacks } from './types';
import { customFetch as fetch } from './fetch';

export class GeminiProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    this.model = config.model || 'gemini-2.0-flash';
    this.apiKey = config.apiKey ?? '';
  }

  private toContents(messages: ChatMessage[], systemPrompt?: string) {
    return {
      contents: messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    };
  }

  async complete(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.toContents(messages, systemPrompt)),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Gemini error: ${response.status} — ${(err as any)?.error?.message ?? response.statusText}`);
    }
    const data = await response.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    if (!text) throw new Error('Gemini returned empty response');
    return text;
  }

  stream(messages: ChatMessage[], systemPrompt: string, callbacks: StreamCallbacks): () => void {
    const { onToken, onDone, onError } = callbacks;
    const controller = new AbortController();
    const url = `${this.baseUrl}/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    (async () => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(this.toContents(messages, systemPrompt)),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          onError(`Gemini error ${res.status}: ${(err as any)?.error?.message ?? res.statusText}`);
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
              const text = obj.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) onToken(text);
              const finishReason = obj.candidates?.[0]?.finishReason;
              if (finishReason && finishReason !== 'FINISH_REASON_UNSPECIFIED') { onDone(); return; }
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
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.baseUrl}/v1beta/models?key=${this.apiKey}`, { signal: controller.signal });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models ?? [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => (m.name as string).replace('models/', ''));
    } catch { return []; }
  }

  async checkOnline(): Promise<boolean> {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.baseUrl}/v1beta/models?key=${this.apiKey}`, { signal: controller.signal });
      return res.ok || res.status === 400;
    } catch { return false; }
  }
}
