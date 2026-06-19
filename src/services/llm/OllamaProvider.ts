import { LLMProvider, ProviderConfig, ChatMessage, StreamCallbacks } from './types';
import { customFetch as fetch } from './fetch';

// Bound non-streaming completions so a hung server can't stall the conductor
// pipeline / auto-answer forever (the call site only awaits this promise).
const COMPLETE_TIMEOUT_MS = 90_000;

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    this.model = config.model;
  }

  async complete(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const allMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COMPLETE_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model: this.model, messages: allMessages, stream: false }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      const text = data.message?.content ?? data.response ?? '';
      if (!text) throw new Error('Ollama returned empty response');
      return text.trim();
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new Error('Ollama request timed out');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  stream(messages: ChatMessage[], systemPrompt: string, callbacks: StreamCallbacks): () => void {
    const { onToken, onDone, onError } = callbacks;
    const controller = new AbortController();
    const allMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ model: this.model, messages: allMessages, stream: true }),
        });
        if (!res.ok) { onError(`Ollama error ${res.status}: ${res.statusText}`); return; }

        const reader = res.body?.getReader();
        if (!reader) { onError('No response body'); return; }
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // Buffer across reads — a JSON line can be split mid-token between two
          // chunks; splitting each chunk independently dropped those tokens.
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            try {
              const obj = JSON.parse(t);
              if (obj.message?.content) onToken(obj.message.content);
              if (obj.done) { onDone(); return; }
            } catch { /* skip malformed */ }
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models ?? []).map((m: { name: string }) => m.name);
    } catch { return []; }
    finally { clearTimeout(timer); }
  }

  async checkOnline(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      return res.ok;
    } catch { return false; }
    finally { clearTimeout(timer); }
  }
}
