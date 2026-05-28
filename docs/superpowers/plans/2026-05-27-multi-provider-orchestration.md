# Multi-Provider Orchestration + Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardwired Ollama calls with a pluggable LLM provider layer (Ollama, OpenAI-compatible, Anthropic, Gemini), fix sentinel detection, and fix interactive prompt auto-answer.

**Architecture:** New `src/services/llm/` module defines `LLMProvider` interface + 4 implementations. `ollamaRelay.ts` becomes pure prompt-builder functions (no HTTP). Engine and orchestrator services receive `LLMProvider` instances. `DashboardContext` exposes live provider instances computed from `settings.llmProviders`.

**Tech Stack:** TypeScript, Vitest, React, Tauri. No new npm packages required.

---

## File Map

| Action | File |
|--------|------|
| NEW | `src/services/llm/types.ts` |
| NEW | `src/services/llm/OllamaProvider.ts` |
| NEW | `src/services/llm/OpenAICompatProvider.ts` |
| NEW | `src/services/llm/AnthropicProvider.ts` |
| NEW | `src/services/llm/GeminiProvider.ts` |
| NEW | `src/services/llm/providerFactory.ts` |
| NEW | `src/services/llm/index.ts` |
| NEW | `src/tests/llm/OllamaProvider.test.ts` |
| NEW | `src/tests/llm/OpenAICompatProvider.test.ts` |
| NEW | `src/tests/llm/AnthropicProvider.test.ts` |
| NEW | `src/tests/llm/GeminiProvider.test.ts` |
| NEW | `src/tests/llm/providerFactory.test.ts` |
| MODIFY | `src/services/sentinelParser.ts` — strip ANSI before `indexOf` |
| MODIFY | `src/services/bufferWatcher.ts` — fix interactive prompt regex |
| MODIFY | `src/services/ollamaRelay.ts` — pure prompt builders, no HTTP |
| MODIFY | `src/types/workspace.types.ts` — add `UseCaseProviders`, `llmProviders` to `AppSettings` |
| MODIFY | `src/services/orchestratorEngine.ts` — inject `LLMProvider` instances |
| MODIFY | `src/services/autonomousOrchestrator.ts` — inject `LLMProvider` |
| MODIFY | `src/services/needsBroker.ts` — inject `LLMProvider` |
| MODIFY | `src/context/DashboardContext.tsx` — migration + live providers |
| MODIFY | `src/components/ui/GroupChat.tsx` — use provider instances |
| MODIFY | `src/pages/Conductor.tsx` — updated updateConfig call |
| MODIFY | `src/components/conductor/WorkspaceConductor.tsx` — updated updateConfig call |
| MODIFY | `src/pages/Settings.tsx` — new LLM Providers UI |
| MODIFY | `src/tests/sentinelParser.test.ts` — add ANSI sentinel test |

---

### Task 1: Fix sentinel ANSI stripping bug

**Files:**
- Modify: `src/services/sentinelParser.ts`
- Modify: `src/tests/sentinelParser.test.ts`

- [ ] **Step 1: Add failing test to sentinelParser.test.ts**

Open `src/tests/sentinelParser.test.ts`. Add this import and test block at the end (before the closing `}`):

```typescript
import { describe, it, expect } from 'vitest';
import { parseNeedsBlock, parseSentinel } from '../services/sentinelParser';
```

Replace the existing import line with the above (adds `parseSentinel`), then append:

```typescript
describe('parseSentinel', () => {
  it('returns null when no sentinel is present', () => {
    expect(parseSentinel('some terminal output')).toBeNull();
  });

  it('parses a clean sentinel block', () => {
    const buf = [
      'Agent did some work',
      '###ORCHATERM_DONE###',
      'task_id: task-1',
      'summary: Built the login page.',
      'files_modified: src/login.tsx',
      'needs: none',
      '###ORCHATERM_END###',
    ].join('\n');
    const result = parseSentinel(buf);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('task-1');
    expect(result!.summary).toBe('Built the login page.');
    expect(result!.filesModified).toEqual(['src/login.tsx']);
    expect(result!.needs).toBe('none');
  });

  it('parses sentinel when markers are wrapped in ANSI codes', () => {
    const buf = [
      'Agent output',
      '\x1b[32m###ORCHATERM_DONE###\x1b[0m',
      'task_id: task-2',
      'summary: Fixed the bug.',
      'files_modified: none',
      'needs: none',
      '\x1b[0m###ORCHATERM_END###',
    ].join('\n');
    const result = parseSentinel(buf);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('task-2');
    expect(result!.summary).toBe('Fixed the bug.');
  });

  it('rejects sentinel echo (placeholder summary)', () => {
    const buf = [
      '###ORCHATERM_DONE###',
      'task_id: task-1',
      'summary: <2-3 sentences: what you built>',
      'files_modified: none',
      'needs: none',
      '###ORCHATERM_END###',
    ].join('\n');
    expect(parseSentinel(buf)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — confirm ANSI test fails**

```
npx vitest run src/tests/sentinelParser.test.ts
```

Expected: `parses sentinel when markers are wrapped in ANSI codes` → FAIL

- [ ] **Step 3: Fix parseSentinel in sentinelParser.ts**

In `src/services/sentinelParser.ts`, find `parseSentinel` and replace its body:

```typescript
export function parseSentinel(rawBuffer: string): OrchestratorTaskOutput | null {
  // Strip ANSI codes before searching — Claude Code wraps output in escape sequences
  // that can land within marker text, breaking a raw indexOf search.
  const buffer = stripAnsiCodes(rawBuffer);

  const startIdx = buffer.indexOf(SENTINEL_START);
  if (startIdx === -1) return null;

  const endIdx = buffer.indexOf(SENTINEL_END, startIdx);
  if (endIdx === -1) return null;

  const block = buffer.slice(startIdx + SENTINEL_START.length, endIdx).trim();
  const raw   = buffer.slice(0, startIdx).trim();

  const taskId       = extractField(block, 'task_id');
  const summary      = extractField(block, 'summary');
  const filesRaw     = extractField(block, 'files_modified');
  const needs        = extractField(block, 'needs');

  const filesModified = filesRaw.toLowerCase() === 'none' || filesRaw === ''
    ? []
    : filesRaw.split(',').map(f => f.trim()).filter(Boolean);

  if (summary.includes('<2-3 sentences')) return null;

  return { raw, taskId, summary, filesModified, needs };
}
```

- [ ] **Step 4: Run tests — all pass**

```
npx vitest run src/tests/sentinelParser.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```
git add src/services/sentinelParser.ts src/tests/sentinelParser.test.ts
git commit -m "fix(sentinel): strip ANSI codes before marker search in parseSentinel"
```

---

### Task 2: Fix interactive prompt regex

**Files:**
- Modify: `src/services/bufferWatcher.ts`

- [ ] **Step 1: Open bufferWatcher.ts and find checkInteractivePrompt**

Locate this line in `checkInteractivePrompt`:
```typescript
const INTERACTIVE_PROMPT_REGEX = /(\[y\/n\]|\?\s*(\n.*)?$|Select an option|Do you want to proceed\?|Type a number)/i;
```

- [ ] **Step 2: Replace with improved regex**

```typescript
const INTERACTIVE_PROMPT_REGEX =
  /(\[y\/n\]|\(y\/n\)|\[Y\/n\]|\(Y\/n\)|\[n\/Y\]|\(n\/Y\)|Do you want to|Press Enter to|Continue\?|Select an option|Type a number|Overwrite\?|already exists)/i;
```

This removes the over-broad `\?\s*(\n.*)?$` pattern (fired on every `?` in output) and adds concrete Claude Code prompt patterns.

- [ ] **Step 3: Commit**

```
git add src/services/bufferWatcher.ts
git commit -m "fix(auto-answer): tighten interactive prompt detection regex"
```

---

### Task 3: Create LLM provider types

**Files:**
- Create: `src/services/llm/types.ts`
- Create: `src/services/llm/index.ts` (stub, completed in Task 8)

- [ ] **Step 1: Create src/services/llm/types.ts**

```typescript
// src/services/llm/types.ts
// Core LLM provider abstraction. All providers implement LLMProvider.
// HTTP logic lives in individual provider files; this file is pure types.

export type ProviderType = 'ollama' | 'openai-compatible' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
  /** Base URL override. Each provider has a sensible default when omitted. */
  baseUrl?: string;
  /** API key. Required for openai-compatible (when cloud), anthropic, gemini. */
  apiKey?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
}

export interface LLMProvider {
  /** Non-streaming completion. Rejects on error or empty response. */
  complete(messages: ChatMessage[], systemPrompt?: string): Promise<string>;
  /** Streaming completion. Returns a cancel function. */
  stream(messages: ChatMessage[], systemPrompt: string, callbacks: StreamCallbacks): () => void;
  /** Available model names, or [] if provider cannot list them. Never throws. */
  listModels(): Promise<string[]>;
  /** Liveness check. Always resolves true/false, never throws. */
  checkOnline(): Promise<boolean>;
}

/** The five use-case slots for per-use-case provider configuration. */
export interface UseCaseProviders {
  relay:      ProviderConfig;   // task handoff summarization
  planGen:    ProviderConfig;   // NL → task plan, intent classification, needs resolution
  autoAnswer: ProviderConfig;   // interactive terminal prompt auto-answering
  chat:       ProviderConfig;   // GroupChat streaming conversation
  routing:    ProviderConfig;   // autonomous agent routing + terminal summarization
}
```

- [ ] **Step 2: Create stub src/services/llm/index.ts**

```typescript
// src/services/llm/index.ts
// Completed in Task 8 after all providers are implemented.
export type { LLMProvider, ProviderConfig, ChatMessage, StreamCallbacks, UseCaseProviders, ProviderType } from './types';
```

- [ ] **Step 3: Commit**

```
git add src/services/llm/types.ts src/services/llm/index.ts
git commit -m "feat(llm): add LLMProvider interface and UseCaseProviders types"
```

---

### Task 4: OllamaProvider

**Files:**
- Create: `src/services/llm/OllamaProvider.ts`
- Create: `src/tests/llm/OllamaProvider.test.ts`

- [ ] **Step 1: Create failing tests — src/tests/llm/OllamaProvider.test.ts**

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OllamaProvider } from '../../services/llm/OllamaProvider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => mockFetch.mockReset());

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
```

- [ ] **Step 2: Run tests — confirm they fail**

```
npx vitest run src/tests/llm/OllamaProvider.test.ts
```

Expected: FAIL — `OllamaProvider` not found.

- [ ] **Step 3: Create src/services/llm/OllamaProvider.ts**

```typescript
import { LLMProvider, ProviderConfig, ChatMessage, StreamCallbacks } from './types';

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

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: allMessages, stream: false }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const text = data.message?.content ?? data.response ?? '';
    if (!text) throw new Error('Ollama returned empty response');
    return text.trim();
  }

  stream(messages: ChatMessage[], systemPrompt: string, callbacks: StreamCallbacks): () => void {
    const { onToken, onDone, onError } = callbacks;
    const controller = new AbortController();
    const allMessages = [{ role: 'system', content: systemPrompt }, ...messages];

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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split('\n')) {
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
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models ?? []).map((m: { name: string }) => m.name);
    } catch { return []; }
  }

  async checkOnline(): Promise<boolean> {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      return res.ok;
    } catch { return false; }
  }
}
```

- [ ] **Step 4: Run tests — all pass**

```
npx vitest run src/tests/llm/OllamaProvider.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```
git add src/services/llm/OllamaProvider.ts src/tests/llm/OllamaProvider.test.ts
git commit -m "feat(llm): add OllamaProvider"
```

---

### Task 5: OpenAICompatProvider

**Files:**
- Create: `src/services/llm/OpenAICompatProvider.ts`
- Create: `src/tests/llm/OpenAICompatProvider.test.ts`

- [ ] **Step 1: Create failing tests**

```typescript
// src/tests/llm/OpenAICompatProvider.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OpenAICompatProvider } from '../../services/llm/OpenAICompatProvider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
beforeEach(() => mockFetch.mockReset());

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

  it('returns [] on error', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    const provider = new OpenAICompatProvider({ provider: 'openai-compatible', model: 'gpt-4o' });
    expect(await provider.listModels()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```
npx vitest run src/tests/llm/OpenAICompatProvider.test.ts
```

- [ ] **Step 3: Create src/services/llm/OpenAICompatProvider.ts**

```typescript
import { LLMProvider, ProviderConfig, ChatMessage, StreamCallbacks } from './types';

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
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.baseUrl}/v1/models`, { headers: this.headers, signal: controller.signal });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data ?? []).map((m: { id: string }) => m.id).sort();
    } catch { return []; }
  }

  async checkOnline(): Promise<boolean> {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.baseUrl}/v1/models`, { headers: this.headers, signal: controller.signal });
      return res.ok;
    } catch { return false; }
  }
}
```

- [ ] **Step 4: Run — all pass**

```
npx vitest run src/tests/llm/OpenAICompatProvider.test.ts
```

- [ ] **Step 5: Commit**

```
git add src/services/llm/OpenAICompatProvider.ts src/tests/llm/OpenAICompatProvider.test.ts
git commit -m "feat(llm): add OpenAICompatProvider (covers OpenAI, LM Studio, DeepSeek, Together.ai)"
```

---

### Task 6: AnthropicProvider

**Files:**
- Create: `src/services/llm/AnthropicProvider.ts`
- Create: `src/tests/llm/AnthropicProvider.test.ts`

- [ ] **Step 1: Create failing tests**

```typescript
// src/tests/llm/AnthropicProvider.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AnthropicProvider } from '../../services/llm/AnthropicProvider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
beforeEach(() => mockFetch.mockReset());

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
    expect(models).toContain('claude-opus-4-7');
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
    expect(await provider.checkOnline()).toBe(false);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```
npx vitest run src/tests/llm/AnthropicProvider.test.ts
```

- [ ] **Step 3: Create src/services/llm/AnthropicProvider.ts**

```typescript
import { LLMProvider, ProviderConfig, ChatMessage, StreamCallbacks } from './types';

const ANTHROPIC_VERSION = '2023-06-01';
const HARDCODED_MODELS = [
  'claude-opus-4-7',
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
    };
  }

  async complete(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 1024,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemPrompt) body.system = systemPrompt;

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers,
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
  }

  stream(messages: ChatMessage[], systemPrompt: string, callbacks: StreamCallbacks): () => void {
    const { onToken, onDone, onError } = callbacks;
    const controller = new AbortController();
    const body: Record<string, unknown> = {
      model: this.model, max_tokens: 1024, stream: true,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      system: systemPrompt,
    };

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
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 2000);
      // Send a minimal request — any response < 500 means API is reachable
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST', headers: this.headers,
        signal: controller.signal,
        body: JSON.stringify({ model: this.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
      return res.status < 500;
    } catch { return false; }
  }
}
```

- [ ] **Step 4: Run — all pass**

```
npx vitest run src/tests/llm/AnthropicProvider.test.ts
```

- [ ] **Step 5: Commit**

```
git add src/services/llm/AnthropicProvider.ts src/tests/llm/AnthropicProvider.test.ts
git commit -m "feat(llm): add AnthropicProvider"
```

---

### Task 7: GeminiProvider

**Files:**
- Create: `src/services/llm/GeminiProvider.ts`
- Create: `src/tests/llm/GeminiProvider.test.ts`

- [ ] **Step 1: Create failing tests**

```typescript
// src/tests/llm/GeminiProvider.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { GeminiProvider } from '../../services/llm/GeminiProvider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
beforeEach(() => mockFetch.mockReset());

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
    expect(await provider.listModels()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```
npx vitest run src/tests/llm/GeminiProvider.test.ts
```

- [ ] **Step 3: Create src/services/llm/GeminiProvider.ts**

```typescript
import { LLMProvider, ProviderConfig, ChatMessage, StreamCallbacks } from './types';

export class GeminiProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    this.model = config.model || 'gemini-1.5-flash';
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
              if (obj.candidates?.[0]?.finishReason === 'STOP') { onDone(); return; }
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
```

- [ ] **Step 4: Run — all pass**

```
npx vitest run src/tests/llm/GeminiProvider.test.ts
```

- [ ] **Step 5: Commit**

```
git add src/services/llm/GeminiProvider.ts src/tests/llm/GeminiProvider.test.ts
git commit -m "feat(llm): add GeminiProvider"
```

---

### Task 8: providerFactory + complete index

**Files:**
- Create: `src/services/llm/providerFactory.ts`
- Create: `src/tests/llm/providerFactory.test.ts`
- Modify: `src/services/llm/index.ts`

- [ ] **Step 1: Create failing tests**

```typescript
// src/tests/llm/providerFactory.test.ts
import { describe, it, expect } from 'vitest';
import { createProvider } from '../../services/llm/providerFactory';
import { OllamaProvider } from '../../services/llm/OllamaProvider';
import { OpenAICompatProvider } from '../../services/llm/OpenAICompatProvider';
import { AnthropicProvider } from '../../services/llm/AnthropicProvider';
import { GeminiProvider } from '../../services/llm/GeminiProvider';

describe('createProvider', () => {
  it('returns OllamaProvider for ollama', () => {
    expect(createProvider({ provider: 'ollama', model: 'llama3.2' })).toBeInstanceOf(OllamaProvider);
  });
  it('returns OpenAICompatProvider for openai-compatible', () => {
    expect(createProvider({ provider: 'openai-compatible', model: 'gpt-4o' })).toBeInstanceOf(OpenAICompatProvider);
  });
  it('returns AnthropicProvider for anthropic', () => {
    expect(createProvider({ provider: 'anthropic', model: 'claude-sonnet-4-6' })).toBeInstanceOf(AnthropicProvider);
  });
  it('returns GeminiProvider for gemini', () => {
    expect(createProvider({ provider: 'gemini', model: 'gemini-1.5-flash' })).toBeInstanceOf(GeminiProvider);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```
npx vitest run src/tests/llm/providerFactory.test.ts
```

- [ ] **Step 3: Create src/services/llm/providerFactory.ts**

```typescript
import { ProviderConfig, LLMProvider } from './types';
import { OllamaProvider } from './OllamaProvider';
import { OpenAICompatProvider } from './OpenAICompatProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GeminiProvider } from './GeminiProvider';

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'ollama':            return new OllamaProvider(config);
    case 'openai-compatible': return new OpenAICompatProvider(config);
    case 'anthropic':         return new AnthropicProvider(config);
    case 'gemini':            return new GeminiProvider(config);
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}
```

- [ ] **Step 4: Replace src/services/llm/index.ts with full exports**

```typescript
export type { LLMProvider, ProviderConfig, ChatMessage, StreamCallbacks, UseCaseProviders, ProviderType } from './types';
export { createProvider } from './providerFactory';
export { OllamaProvider } from './OllamaProvider';
export { OpenAICompatProvider } from './OpenAICompatProvider';
export { AnthropicProvider } from './AnthropicProvider';
export { GeminiProvider } from './GeminiProvider';
```

- [ ] **Step 5: Run all provider tests**

```
npx vitest run src/tests/llm/
```

Expected: All pass.

- [ ] **Step 6: Commit**

```
git add src/services/llm/providerFactory.ts src/services/llm/index.ts src/tests/llm/providerFactory.test.ts
git commit -m "feat(llm): add providerFactory and complete llm/index exports"
```

---

### Task 9: Refactor ollamaRelay.ts to pure prompt builders

**Files:**
- Rewrite: `src/services/ollamaRelay.ts`

The file keeps: `CompletedTaskContext`, `RawPlanTask`, `buildPassThroughBrief`, and all system prompts / prompt builder functions. It removes: all `fetch` calls, `callOllama`, `checkOllamaOnline`, `fetchOllamaModels`, `streamChatWithOllama`. `ChatMessage` moves to `src/services/llm/types.ts` (already done in Task 3) — re-export it here for backward compat during this task.

- [ ] **Step 1: Rewrite src/services/ollamaRelay.ts**

```typescript
/**
 * ollamaRelay.ts
 *
 * Pure prompt-building functions for the orchestrator. No HTTP calls.
 * All LLM calls go through LLMProvider implementations in src/services/llm/.
 *
 * Each buildXxxPrompt function returns { system, userContent } ready to pass to
 * provider.complete([{ role: 'user', content: userContent }], system).
 */

import { OrchestratorTaskOutput } from '../types';
export type { ChatMessage } from './llm/types';  // re-export for backward compat

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompletedTaskContext {
  taskTitle: string;
  taskDescription: string;
  agentName: string;
  agentBestUsedFor: string;
  output: OrchestratorTaskOutput;
}

export interface RawPlanTask {
  title: string;
  description: string;
  assignedSessionTitle: string;
  dependsOn: string[];
}

// ── System prompts ────────────────────────────────────────────────────────────

export const RELAY_SYSTEM_PROMPT = `You are a message relay for a multi-agent coding workflow.
Your only job is to reformat completed task output into a clear brief for the next agent.

Rules you must follow:
1. Extract only meaningful results. Ignore shell prompts, file listings, build output, and status messages.
2. Keep your output under 200 words.
3. Do NOT add implementation suggestions or technical opinions.
4. Do NOT explain what you are doing — just write the brief.
5. Write in direct, imperative style addressed to the next agent.
6. Preserve specific identifiers: function names, file paths, API contracts, variable names.`;

export const PLAN_GEN_SYSTEM_PROMPT = `You are a task planner for a multi-agent terminal orchestration system.
Given a goal and a list of available terminal agents, break the goal into a minimal set of concrete tasks.

Return ONLY a valid JSON array. No markdown fences. No explanation. No prose before or after.

JSON format:
[
  {
    "title": "Short task name",
    "description": "Precise, self-contained instructions for the agent. Be specific and direct.",
    "assignedSessionTitle": "<MUST match one of the available agent names exactly>",
    "dependsOn": ["<title of a task that must complete before this one starts>"]
  }
]

Rules:
- Tasks that can run in parallel must NOT depend on each other.
- Each task description must stand alone — the agent receives nothing else.
- Only add a dependency when the task genuinely needs that task's output.
- Assign tasks thoughtfully based on agent names/roles.
- dependsOn titles must exactly match the "title" field of another task in the array.`;

// ── Prompt builders ───────────────────────────────────────────────────────────

export function buildRelayPrompt(
  goal: string,
  completedTask: CompletedTaskContext,
  nextTaskDescription: string,
  nextAgentName: string,
): { system: string; userContent: string } {
  return {
    system: RELAY_SYSTEM_PROMPT,
    userContent: `Overall goal: ${goal}

COMPLETED WORK:
Task: ${completedTask.taskTitle}
Done by: ${completedTask.agentName}
Summary: ${completedTask.output.summary}
Files modified: ${completedTask.output.filesModified.join(', ') || 'none'}
What is needed next: ${completedTask.output.needs}

NEXT TASK:
Task: ${nextTaskDescription}
Next agent: ${nextAgentName}

Write a clear, direct brief for the next agent that gives them everything they need:`,
  };
}

export function buildMergeRelayPrompt(
  goal: string,
  completedTasks: CompletedTaskContext[],
  nextTaskDescription: string,
  nextAgentName: string,
): { system: string; userContent: string } {
  const blocks = completedTasks.map((t, i) => `
--- Completed Work ${i + 1} ---
Task: ${t.taskTitle}
Done by: ${t.agentName}
Summary: ${t.output.summary}
Files modified: ${t.output.filesModified.join(', ') || 'none'}
What is needed next: ${t.output.needs}`).join('\n');

  return {
    system: RELAY_SYSTEM_PROMPT,
    userContent: `Overall goal: ${goal}

COMPLETED WORK FROM MULTIPLE AGENTS:
${blocks}

NEXT TASK:
Task: ${nextTaskDescription}
Next agent: ${nextAgentName}

Synthesize all completed work into a single unified brief for the next agent:`,
  };
}

export function buildAutoAnswerPrompt(promptText: string): { system: string; userContent: string } {
  return {
    system: "You are an automated terminal responder. Output only the keystroke or 'UNKNOWN'.",
    userContent: `A terminal agent is stuck on the following interactive prompt and needs user input to proceed.
Prompt:
"""
${promptText}
"""

Determine what the user should type to accept or safely proceed.
Examples:
- If asked "Do you want to proceed? [y/N]", answer "y"
- If asked "Select an option: 1. Yes 2. No", answer "1"
- If asked "Press Enter to continue", answer "\\n"
- If the prompt is ambiguous, dangerous (e.g. deleting files), or asks for complex text input, answer "UNKNOWN"

Return ONLY the exact keystrokes/text to send. No explanation. No quotes.`,
  };
}

export function buildRoutingPrompt(
  fromTitle: string,
  recentChunk: string,
  siblings: Array<{ title: string; recentOutput: string }>,
): { system: string; userContent: string } {
  const siblingsDesc = siblings
    .map(s => `• ${s.title}:\n${s.recentOutput.slice(-300) || '(no recent output)'}`)
    .join('\n\n');

  return {
    system: 'You are a routing agent for a multi-agent coding team. Be decisive. Output exactly one line.',
    userContent: `You are monitoring a team of AI coding agents.

Agent "${fromTitle}" just produced this output:
${recentChunk.slice(-600)}

Other active agents:
${siblingsDesc}

Should any part of "${fromTitle}"'s output be relayed to another agent right now?

Rules:
1. Only relay if it would DIRECTLY unblock or help another agent with what they are doing.
2. Routine build output, status messages, and progress logs should NOT be relayed.
3. Keep any injected message under 80 words. Be direct — no filler.
4. Do NOT relay if the agents are working on completely independent tasks.

If nothing should be relayed, output exactly: NO_RELAY
If relaying, output exactly one line: INJECT → <exact-terminal-title>: <message>`,
  };
}

export function buildSummarisePrompt(chunk: string, tabTitle: string): { system: string; userContent: string } {
  return {
    system: `You are a terminal output summariser. Summarise the following terminal output from agent "${tabTitle}" in 1–2 concise sentences. Be direct and factual — no filler, no suggestions. Output only the summary text, nothing else.`,
    userContent: chunk.length > 2000 ? chunk.slice(-2000) : chunk,
  };
}

export function buildPlanGenPrompt(
  goal: string,
  availableSessions: Array<{ title: string }>,
): { system: string; userContent: string } {
  return {
    system: PLAN_GEN_SYSTEM_PROMPT,
    userContent: `Goal: ${goal}

Available agents:
${availableSessions.map(s => `• ${s.title}`).join('\n')}

Generate the task plan as a JSON array:`,
  };
}

export function buildNeedsPrompt(
  ask: string,
  context: string,
  requestingAgent: string,
  peerContext: Array<{ title: string; recentOutput: string }>,
): { system: string; userContent: string } {
  const peerBlocks = peerContext.length > 0
    ? peerContext.map(p => `=== ${p.title} ===\n${p.recentOutput || '(no recent output)'}`).join('\n\n')
    : '(no peer agents have recent output)';

  return {
    system: 'You are a helpful synthesiser. Output only a direct answer under 150 words.',
    userContent: `Agent "${requestingAgent}" is asking for help mid-task.

QUESTION: ${ask}
THEIR CONTEXT: ${context || '(none provided)'}

WHAT OTHER AGENTS HAVE BEEN DOING:
${peerBlocks}

Write a direct, actionable answer (≤ 150 words) synthesised from the other agents' work.
Include specific identifiers (function names, file paths, variable names) where relevant.
If the peer output contains no relevant information, say so in one sentence.
Do NOT add suggestions beyond what was asked.`,
  };
}

export function buildIntentClassifyPrompt(message: string): { system: string; userContent: string } {
  return {
    system: "You are a strict classifier. Output exactly one word: 'chat' or 'plan'.",
    userContent: `You are an intent classifier for a developer orchestration tool.
The user is talking to an orchestrator that can either:
1. "chat": Answer questions, route a simple instruction to a terminal, or summarize.
2. "plan": Break down a goal into a multi-step pipeline and assign agents to tasks.

Classify the following user message. If the message describes building a feature, creating a pipeline, or assigning multiple agents to a goal, classify it as "plan". Otherwise, classify it as "chat".

Return ONLY the word "chat" or "plan". No other text.

Message: "${message}"`,
  };
}

// ── Pass-through fallback (no LLM needed) ────────────────────────────────────

export function buildPassThroughBrief(
  completedTasks: CompletedTaskContext[],
  nextTaskDescription: string,
): string {
  const contextLines = completedTasks.map(t =>
    `[Context from: ${t.taskTitle}]\nSummary: ${t.output.summary}\nWhat you need: ${t.output.needs}`
  ).join('\n\n');
  return `${contextLines}\n\nYour task: ${nextTaskDescription}`;
}

// ── Plan JSON parsing (used after calling planGen provider) ──────────────────

export function parsePlanGenResponse(response: string): RawPlanTask[] {
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Plan generation returned no JSON array. Try rephrasing your goal.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Plan generation returned invalid JSON: ${e}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Plan generation returned an empty or invalid task list.');
  }
  return parsed as RawPlanTask[];
}
```

- [ ] **Step 2: Run existing tests to confirm nothing broken**

```
npx vitest run src/tests/
```

The tests for `autonomousOrchestrator` and `needsBroker` mock `ollamaRelay` — they will need updating in later tasks once we change those service signatures. Check they still pass (they mock the module, so should be fine for now).

- [ ] **Step 3: Commit**

```
git add src/services/ollamaRelay.ts
git commit -m "refactor(ollamaRelay): replace HTTP calls with pure prompt builders; remove Ollama coupling"
```

---

### Task 10: Update AppSettings type

**Files:**
- Modify: `src/types/workspace.types.ts`

- [ ] **Step 1: Add UseCaseProviders import and update AppSettings**

Open `src/types/workspace.types.ts`. Add import at top and update `AppSettings`:

```typescript
import type { UseCaseProviders } from '../services/llm/types';
```

Replace the existing `AppSettings` interface with:

```typescript
export interface AppSettings {
  shellPath: string;
  conductorTaskTimeoutMinutes: number;
  /** Per-use-case LLM provider configuration. */
  llmProviders: UseCaseProviders;
  // ── Legacy fields kept for one-time migration on first load ──────────────
  /** @deprecated Use llmProviders.relay.baseUrl instead. */
  ollamaHost?: string;
  /** @deprecated No longer used directly. */
  openaiApiKey?: string;
  /** @deprecated No longer used directly. */
  anthropicApiKey?: string;
  /** @deprecated Use llmProviders.relay.model instead. */
  conductorOllamaModel?: string;
}
```

- [ ] **Step 2: Update the default settings in DashboardContext.tsx**

Open `src/context/DashboardContext.tsx`. Find the `useState<AppSettings>` call and replace the default value:

```typescript
const DEFAULT_OLLAMA_CONFIG = {
  provider: 'ollama' as const,
  model: 'llama3.2',
  baseUrl: 'http://localhost:11434',
};

const [settings, setSettings] = useState<AppSettings>({
  shellPath: '',
  conductorTaskTimeoutMinutes: 30,
  llmProviders: {
    relay:      { ...DEFAULT_OLLAMA_CONFIG },
    planGen:    { ...DEFAULT_OLLAMA_CONFIG },
    autoAnswer: { ...DEFAULT_OLLAMA_CONFIG },
    chat:       { ...DEFAULT_OLLAMA_CONFIG },
    routing:    { ...DEFAULT_OLLAMA_CONFIG },
  },
});
```

Add the migration function before the `useEffect` that loads data:

```typescript
/** Migrate settings from legacy ollamaHost/conductorOllamaModel to llmProviders. */
function migrateSettings(raw: Partial<AppSettings>): AppSettings {
  if (raw.llmProviders) {
    // Already migrated — just fill in any missing use-case slots with defaults
    return {
      shellPath: raw.shellPath ?? '',
      conductorTaskTimeoutMinutes: raw.conductorTaskTimeoutMinutes ?? 30,
      llmProviders: {
        relay:      raw.llmProviders.relay      ?? { ...DEFAULT_OLLAMA_CONFIG },
        planGen:    raw.llmProviders.planGen    ?? { ...DEFAULT_OLLAMA_CONFIG },
        autoAnswer: raw.llmProviders.autoAnswer ?? { ...DEFAULT_OLLAMA_CONFIG },
        chat:       raw.llmProviders.chat       ?? { ...DEFAULT_OLLAMA_CONFIG },
        routing:    raw.llmProviders.routing    ?? { ...DEFAULT_OLLAMA_CONFIG },
      },
    };
  }

  // Legacy migration: build llmProviders from old ollamaHost + conductorOllamaModel
  const legacyConfig = {
    provider: 'ollama' as const,
    model: raw.conductorOllamaModel || 'llama3.2',
    baseUrl: raw.ollamaHost || 'http://localhost:11434',
  };
  return {
    shellPath: raw.shellPath ?? '',
    conductorTaskTimeoutMinutes: raw.conductorTaskTimeoutMinutes ?? 30,
    llmProviders: {
      relay:      { ...legacyConfig },
      planGen:    { ...legacyConfig },
      autoAnswer: { ...legacyConfig },
      chat:       { ...legacyConfig },
      routing:    { ...legacyConfig },
    },
  };
}
```

In the `init` async function inside `useEffect`, change:
```typescript
if (data.settings) setSettings(prev => ({ ...prev, ...data.settings }));
```
to:
```typescript
if (data.settings) setSettings(migrateSettings(data.settings));
```

- [ ] **Step 3: Build check**

```
npx tsc --noEmit
```

Fix any type errors (the legacy optional fields like `ollamaHost` are removed from the required type — callers that reference `settings.ollamaHost` will error; those are fixed in Tasks 11–15).

- [ ] **Step 4: Commit**

```
git add src/types/workspace.types.ts src/context/DashboardContext.tsx
git commit -m "feat(settings): add UseCaseProviders to AppSettings with legacy migration"
```

---

### Task 11: Update OrchestratorEngine

**Files:**
- Modify: `src/services/orchestratorEngine.ts`

- [ ] **Step 1: Update imports and EngineConfig**

Replace the top of `src/services/orchestratorEngine.ts`:

```typescript
import { writePtyChunked } from '../utils/ptyUtils';
import {
  OrchestratorPlan,
  OrchestratorTask,
  OrchestratorTaskOutput,
  ConductorLogEntry,
} from '../types';
import { bufferWatcher } from './bufferWatcher';
import {
  buildRelayPrompt,
  buildMergeRelayPrompt,
  buildPassThroughBrief,
  buildAutoAnswerPrompt,
  CompletedTaskContext,
} from './ollamaRelay';
import { LLMProvider } from './llm';
import { SENTINEL_START, SENTINEL_END, NEEDS_START, NEEDS_END } from './sentinelParser';
```

Replace `EngineConfig` interface:

```typescript
export interface EngineConfig {
  relayProvider:      LLMProvider;
  planGenProvider:    LLMProvider;
  autoAnswerProvider: LLMProvider;
  taskTimeoutMinutes: number;
  sessionTitles: Map<string, string>;
}
```

- [ ] **Step 2: Update constructor and singleton**

Replace the constructor and singleton at bottom of file:

```typescript
constructor(config: EngineConfig) {
  this.config = config;
}
```

Replace the singleton export at the bottom:

```typescript
import { createProvider } from './llm';

// Singleton with sensible default (Ollama local). Overwritten by DashboardContext on mount.
const defaultProvider = createProvider({ provider: 'ollama', model: 'llama3.2' });

export const orchestratorEngine = new OrchestratorEngine({
  relayProvider:      defaultProvider,
  planGenProvider:    defaultProvider,
  autoAnswerProvider: defaultProvider,
  taskTimeoutMinutes: 30,
  sessionTitles: new Map(),
});
```

- [ ] **Step 3: Replace Ollama calls in dispatch()**

Find the block inside `dispatch()` that calls `checkOllamaOnline` / `relayViaOllama` / `mergeAndRelayViaOllama`. Replace it:

```typescript
if (parentTasks.length > 0) {
  const completedContexts: CompletedTaskContext[] = parentTasks.map(t => ({
    taskTitle:        t.title,
    taskDescription:  t.description,
    agentName:        this.config.sessionTitles.get(t.assignedSessionId) ?? t.assignedSessionTitle,
    agentBestUsedFor: '',
    output:           t.output!,
  }));

  const nextSessionTitle = this.config.sessionTitles.get(task.assignedSessionId) ?? task.assignedSessionTitle;

  try {
    if (parentTasks.length === 1) {
      const { system, userContent } = buildRelayPrompt(
        this.plan.goal, completedContexts[0], task.description, nextSessionTitle,
      );
      contextBrief = await this.config.relayProvider.complete(
        [{ role: 'user', content: userContent }], system,
      );
    } else {
      const { system, userContent } = buildMergeRelayPrompt(
        this.plan.goal, completedContexts, task.description, nextSessionTitle,
      );
      contextBrief = await this.config.relayProvider.complete(
        [{ role: 'user', content: userContent }], system,
      );
    }

    this.log('relay', `Relay complete for task "${task.title}"`, task.id);

    const lastParent = parentTasks[parentTasks.length - 1];
    if (lastParent.output) {
      this.updateTask(lastParent.id, {
        output: { ...lastParent.output, relayedBrief: contextBrief },
      });
    }
  } catch {
    contextBrief = buildPassThroughBrief(completedContexts, task.description);
    this.log('info', `Provider unavailable — pass-through relay used for "${task.title}"`, task.id);
  }
}
```

- [ ] **Step 4: Replace auto-answer call in dispatch()**

Find `const answer = await autoAnswerInteractivePrompt(...)` and replace the auto-answer block:

```typescript
async (promptText) => {
  const shortPrompt = promptText.length > 50 ? promptText.slice(0, 47) + '...' : promptText;
  try {
    const { system, userContent } = buildAutoAnswerPrompt(promptText);
    const answer = await this.config.autoAnswerProvider.complete(
      [{ role: 'user', content: userContent }], system,
    );
    const trimmed = answer.trim();

    if (trimmed && trimmed !== 'UNKNOWN') {
      await writePtyChunked(task.assignedSessionId, trimmed + '\r');
      this.log('info', `🤖 Auto-answered prompt ("${shortPrompt}") with: ${trimmed}`, task.id, task.assignedSessionId);
      return;
    }
  } catch (err) {
    this.log('error', `Auto-answer provider error: ${err}`, task.id, task.assignedSessionId);
  }

  this.log(
    'user-override',
    `⚠️ ${task.assignedSessionTitle} is waiting for user input ("${shortPrompt}"). Type INJECT → ${task.assignedSessionTitle}: [your answer] to continue.`,
    task.id, task.assignedSessionId,
  );
}
```

- [ ] **Step 5: TypeScript build check**

```
npx tsc --noEmit
```

Fix any remaining type errors. The callers in `Conductor.tsx` and `WorkspaceConductor.tsx` will error on `ollamaHost`/`ollamaModel` — those are fixed in Task 15.

- [ ] **Step 6: Commit**

```
git add src/services/orchestratorEngine.ts
git commit -m "feat(engine): inject LLMProvider instances; remove direct Ollama dependency"
```

---

### Task 12: Update AutonomousOrchestrator and NeedsBroker

**Files:**
- Modify: `src/services/autonomousOrchestrator.ts`
- Modify: `src/services/needsBroker.ts`

- [ ] **Step 1: Update autonomousOrchestrator.ts**

Replace top imports:

```typescript
import { InterruptPolicy, RoutingEvent } from '../types';
import { bufferWatcher } from './bufferWatcher';
import { buildRoutingPrompt, buildSummarisePrompt } from './ollamaRelay';
import { LLMProvider, createProvider } from './llm';
import { canInjectNow } from '../utils/interruptPolicy';
import { writePtyChunked } from '../utils/ptyUtils';
```

Replace `config` field:

```typescript
private routingProvider: LLMProvider = createProvider({ provider: 'ollama', model: 'llama3.2' });
```

Replace `updateConfig`:

```typescript
updateConfig(config: { routingProvider: LLMProvider }): void {
  this.routingProvider = config.routingProvider;
}
```

In `onSummaryChunk`, replace the `evaluateAndRoute` call:

```typescript
let decision;
try {
  const { system, userContent } = buildRoutingPrompt(
    fromSession.title,
    chunk,
    siblings.map(s => ({ title: s.title, recentOutput: bufferWatcher.getBuffer(s.id).slice(-600) })),
  );
  const response = await this.routingProvider.complete([{ role: 'user', content: userContent }], system);
  const trimmed = response.trim();

  if (trimmed === 'NO_RELAY' || !trimmed.includes('INJECT')) {
    decision = { type: 'no_relay' as const };
  } else {
    const match = trimmed.match(/INJECT\s*→\s*([^:\n]+):\s*(.+)/i);
    decision = match
      ? { type: 'inject' as const, targetTitle: match[1].trim(), message: match[2].trim() }
      : { type: 'no_relay' as const };
  }
} catch {
  return;
}
```

Remove the now-unused `checkOllamaOnline` call (the `if (!online) return;` block at the start of `onSummaryChunk`) — providers handle their own connectivity.

- [ ] **Step 2: Update needsBroker.ts**

Replace top imports:

```typescript
import { AgentNeedsRequest, InterruptPolicy, RoutingEvent } from '../types';
import { buildNeedsPrompt } from './ollamaRelay';
import { LLMProvider, createProvider } from './llm';
import { bufferWatcher } from './bufferWatcher';
import { canInjectNow } from '../utils/interruptPolicy';
import { writePtyChunked } from '../utils/ptyUtils';
```

Replace `BrokerConfig` interface and `config` field:

```typescript
private provider: LLMProvider = createProvider({ provider: 'ollama', model: 'llama3.2' });

updateConfig(config: { provider: LLMProvider }): void {
  this.provider = config.provider;
}
```

Find the call to `resolveNeedsRequest` inside `handleNeedsRequest` and replace it:

```typescript
const peerContext = peersWithOutput.map(s => ({
  title: s.title,
  recentOutput: bufferWatcher.getBuffer(s.id).slice(-600),
}));

const { system, userContent } = buildNeedsPrompt(request.ask, request.context, requestingSession.title, peerContext);
const answer = await this.provider.complete([{ role: 'user', content: userContent }], system);
```

Remove the `checkOllamaOnline` call from `handleNeedsRequest`.

- [ ] **Step 3: Update mocks in existing tests**

Open `src/tests/autonomousOrchestrator.test.ts`. The existing mock is:
```typescript
vi.mock('../services/ollamaRelay', () => ({ evaluateAndRoute: vi.fn() }));
```

Update it to mock `buildRoutingPrompt` instead (or mock at the provider level). The simplest fix — since these tests test routing logic, not provider calls — is to mock the `LLMProvider` interface:

```typescript
vi.mock('../services/autonomousOrchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/autonomousOrchestrator')>();
  return actual;
});
```

Then in each test, inject a mock provider via `autonomousOrchestrator.updateConfig({ routingProvider: mockProvider })` where:

```typescript
const mockProvider = {
  complete: vi.fn().mockResolvedValue('NO_RELAY'),
  stream: vi.fn(),
  listModels: vi.fn().mockResolvedValue([]),
  checkOnline: vi.fn().mockResolvedValue(true),
};
```

Make similar updates to `src/tests/needsBroker.test.ts`.

- [ ] **Step 4: Run existing tests**

```
npx vitest run src/tests/autonomousOrchestrator.test.ts src/tests/needsBroker.test.ts
```

Fix any failures.

- [ ] **Step 5: Commit**

```
git add src/services/autonomousOrchestrator.ts src/services/needsBroker.ts src/tests/autonomousOrchestrator.test.ts src/tests/needsBroker.test.ts
git commit -m "feat(orchestrator): inject LLMProvider into AutonomousOrchestrator and NeedsBroker"
```

---

### Task 13: Update DashboardContext — expose live providers

**Files:**
- Modify: `src/context/DashboardContext.tsx`

- [ ] **Step 1: Add provider state to DashboardContext**

Add imports at top of `src/context/DashboardContext.tsx`:

```typescript
import { createProvider, LLMProvider } from '../services/llm';
import type { UseCaseProviders } from '../services/llm/types';
import { orchestratorEngine } from '../services/orchestratorEngine';
import { autonomousOrchestrator } from '../services/autonomousOrchestrator';
import { needsBroker } from '../services/needsBroker';
```

Add these to `DashboardContextType` interface:

```typescript
/** Live LLM provider instances, recreated when settings.llmProviders changes. */
llmProviders: {
  relay:      LLMProvider;
  planGen:    LLMProvider;
  autoAnswer: LLMProvider;
  chat:       LLMProvider;
  routing:    LLMProvider;
};
```

Add helper function before the provider component:

```typescript
function makeProviders(cfg: UseCaseProviders) {
  return {
    relay:      createProvider(cfg.relay),
    planGen:    createProvider(cfg.planGen),
    autoAnswer: createProvider(cfg.autoAnswer),
    chat:       createProvider(cfg.chat),
    routing:    createProvider(cfg.routing),
  };
}
```

Add state inside `DashboardProvider`:

```typescript
const [llmProviders, setLlmProviders] = useState(() =>
  makeProviders(settings.llmProviders ?? {
    relay:      { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://localhost:11434' },
    planGen:    { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://localhost:11434' },
    autoAnswer: { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://localhost:11434' },
    chat:       { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://localhost:11434' },
    routing:    { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://localhost:11434' },
  })
);
```

Add a `useEffect` that reacts to settings changes and pushes providers to engines:

```typescript
useEffect(() => {
  if (!settings.llmProviders) return;
  const p = makeProviders(settings.llmProviders);
  setLlmProviders(p);

  orchestratorEngine.updateConfig({
    relayProvider:      p.relay,
    planGenProvider:    p.planGen,
    autoAnswerProvider: p.autoAnswer,
    taskTimeoutMinutes: settings.conductorTaskTimeoutMinutes,
    sessionTitles:      new Map(), // populated per-plan when engine.start() is called
  });

  autonomousOrchestrator.updateConfig({ routingProvider: p.routing });
  needsBroker.updateConfig({ provider: p.planGen });
}, [settings.llmProviders, settings.conductorTaskTimeoutMinutes]);
```

Add `llmProviders` to the context value object.

- [ ] **Step 2: Add llmProviders to context value**

In the `value` object passed to `DashboardContext.Provider`:

```typescript
const value: DashboardContextType = {
  // ... existing fields ...
  llmProviders,
};
```

- [ ] **Step 3: Build check**

```
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```
git add src/context/DashboardContext.tsx
git commit -m "feat(context): expose live LLM provider instances and sync to engine/orchestrator on settings change"
```

---

### Task 14: Update GroupChat, Conductor, WorkspaceConductor call sites

**Files:**
- Modify: `src/components/ui/GroupChat.tsx`
- Modify: `src/pages/Conductor.tsx`
- Modify: `src/components/conductor/WorkspaceConductor.tsx`

- [ ] **Step 1: Update GroupChat.tsx imports**

Replace the `ollamaRelay` import block:

```typescript
import {
  buildPlanGenPrompt,
  buildSummarisePrompt,
  buildIntentClassifyPrompt,
  parsePlanGenResponse,
  buildPassThroughBrief,
  RawPlanTask,
} from '../../services/ollamaRelay';
import type { ChatMessage } from '../../services/llm/types';
```

Remove: `streamChatWithOllama`, `summariseChunk`, `checkOllamaOnline`, `generatePlanFromNL`, `classifyChatIntent` from the import.

Add to the `useDashboard()` destructure:

```typescript
const { ..., llmProviders } = useDashboard();
```

- [ ] **Step 2: Update checkOnline in GroupChat.tsx**

Find `const checkOnline = useCallback(...)` and replace:

```typescript
const checkOnline = useCallback(async () => {
  setChecking(true);
  const ok = await llmProviders.chat.checkOnline();
  setOllamaOnline(ok);
  setChecking(false);
}, [llmProviders.chat]);
```

- [ ] **Step 3: Update summariseChunk call in GroupChat.tsx**

Find the `summariseChunk(...)` call inside the live feed `useEffect` and replace:

```typescript
const { system, userContent } = buildSummarisePrompt(chunk, session.title);
const summary = await llmProviders.routing.complete(
  [{ role: 'user', content: userContent }], system,
);
```

- [ ] **Step 4: Update classifyChatIntent + generatePlanFromNL in GroupChat.tsx**

Find `classifyChatIntent(text, ...)` and replace the entire intent classification + plan generation block:

```typescript
const { system: intentSystem, userContent: intentContent } = buildIntentClassifyPrompt(text);
llmProviders.planGen.complete([{ role: 'user', content: intentContent }], intentSystem)
  .then(res => {
    const intent = res.toLowerCase().trim().includes('plan') ? 'plan' : 'chat';

    if (intent === 'plan') {
      const { system: planSystem, userContent: planContent } = buildPlanGenPrompt(
        text, groupSessions.map(s => ({ title: s.title })),
      );
      llmProviders.planGen.complete([{ role: 'user', content: planContent }], planSystem)
        .then(planRes => {
          try {
            const rawTasks = parsePlanGenResponse(planRes);
            // ... rest of the existing plan-task mapping code (unchanged) ...
```

Keep the rest of the plan-task mapping logic (the part that converts `rawTasks` to `OrchestratorTask[]`) exactly as-is.

- [ ] **Step 5: Update streamChatWithOllama in GroupChat.tsx**

Find `const cancel = streamChatWithOllama({...})` and replace:

```typescript
const cancel = llmProviders.chat.stream(
  newHistory,
  systemPrompt,
  {
    onToken: (token) => {
      // ... existing onToken body unchanged ...
    },
    onDone: () => {
      // ... existing onDone body unchanged ...
    },
    onError: (err) => {
      // ... existing onError body unchanged ...
    },
  }
);
```

- [ ] **Step 6: Update Conductor.tsx**

Find:
```typescript
orchestratorEngine.updateConfig({
  ollamaHost:         settings.ollamaHost,
  ollamaModel:        settings.conductorOllamaModel,
  taskTimeoutMinutes: settings.conductorTaskTimeoutMinutes,
  sessionTitles:      new Map(workspaceSessions.map(s => [s.id, s.title])),
});
```

Replace with:
```typescript
orchestratorEngine.updateConfig({
  relayProvider:      llmProviders.relay,
  planGenProvider:    llmProviders.planGen,
  autoAnswerProvider: llmProviders.autoAnswer,
  taskTimeoutMinutes: settings.conductorTaskTimeoutMinutes,
  sessionTitles:      new Map(workspaceSessions.map(s => [s.id, s.title])),
});
```

Add `llmProviders` to the `useDashboard()` destructure in `Conductor.tsx`.

- [ ] **Step 7: Update WorkspaceConductor.tsx**

Same replacement as Step 6, in `WorkspaceConductor.tsx`. Add `llmProviders` to destructure.

- [ ] **Step 8: Build check**

```
npx tsc --noEmit
```

Fix any remaining type errors.

- [ ] **Step 9: Run all tests**

```
npx vitest run src/tests/
```

All should pass.

- [ ] **Step 10: Commit**

```
git add src/components/ui/GroupChat.tsx src/pages/Conductor.tsx src/components/conductor/WorkspaceConductor.tsx
git commit -m "feat(ui): update GroupChat, Conductor, WorkspaceConductor to use LLMProvider instances"
```

---

### Task 15: Settings UI — LLM Providers section

**Files:**
- Modify: `src/pages/Settings.tsx`

This task replaces the "Conductor / Ollama" card with a new "LLM Providers" card. Five collapsible sections (one per use case), each with: provider preset selector, base URL, API key, model picker with refresh, and a test-connection button.

- [ ] **Step 1: Add new imports to Settings.tsx**

```typescript
import { createProvider } from '../services/llm';
import type { ProviderConfig, UseCaseProviders } from '../services/llm/types';
```

Remove: `import { fetchOllamaModels } from '../services/ollamaRelay';`

- [ ] **Step 2: Define provider preset data**

Add inside the `SettingsView` component, before state declarations:

```typescript
type ProviderPreset = {
  label: string;
  config: Omit<ProviderConfig, 'model'>;
};

const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: 'Ollama (local)',          config: { provider: 'ollama',            baseUrl: 'http://localhost:11434' } },
  { label: 'LM Studio (local)',       config: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234' } },
  { label: 'OpenAI',                  config: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com' } },
  { label: 'DeepSeek',                config: { provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com' } },
  { label: 'Together.ai',             config: { provider: 'openai-compatible', baseUrl: 'https://api.together.xyz' } },
  { label: 'Anthropic',               config: { provider: 'anthropic',         baseUrl: 'https://api.anthropic.com' } },
  { label: 'Google Gemini',           config: { provider: 'gemini',            baseUrl: 'https://generativelanguage.googleapis.com' } },
  { label: 'Custom (OpenAI-compat)',  config: { provider: 'openai-compatible', baseUrl: '' } },
];

const USE_CASE_LABELS: Record<keyof UseCaseProviders, string> = {
  relay:      'Relay (task handoff)',
  planGen:    'Plan Generation',
  autoAnswer: 'Auto-Answer',
  chat:       'Chat',
  routing:    'Routing',
};
```

- [ ] **Step 3: Add ProviderConfigEditor sub-component**

Add this component before `SettingsView`:

```tsx
interface ProviderConfigEditorProps {
  label: string;
  value: ProviderConfig;
  onChange: (cfg: ProviderConfig) => void;
}

const ProviderConfigEditor: React.FC<ProviderConfigEditorProps> = ({ label, value, onChange }) => {
  const [models, setModels] = React.useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = React.useState(false);
  const [testStatus, setTestStatus] = React.useState<'idle' | 'ok' | 'fail'>('idle');

  const currentPreset = PROVIDER_PRESETS.find(
    p => p.config.provider === value.provider && p.config.baseUrl === value.baseUrl,
  );

  const handlePresetChange = (presetLabel: string) => {
    const preset = PROVIDER_PRESETS.find(p => p.label === presetLabel);
    if (!preset) return;
    onChange({ ...value, ...preset.config });
  };

  const needsApiKey = value.provider !== 'ollama' && value.baseUrl !== 'http://localhost:1234';
  const needsBaseUrl = value.provider === 'ollama' || value.provider === 'openai-compatible';

  const handleRefreshModels = async () => {
    setModelsLoading(true);
    try {
      const provider = createProvider(value);
      const list = await provider.listModels();
      setModels(list);
    } catch { setModels([]); }
    finally { setModelsLoading(false); }
  };

  const handleTest = async () => {
    try {
      const provider = createProvider(value);
      const ok = await provider.checkOnline();
      setTestStatus(ok ? 'ok' : 'fail');
    } catch { setTestStatus('fail'); }
    setTimeout(() => setTestStatus('idle'), 3000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{label}</div>

      {/* Preset selector */}
      <Select
        label="Provider"
        value={currentPreset?.label ?? 'Custom (OpenAI-compat)'}
        onChange={handlePresetChange}
        options={PROVIDER_PRESETS.map(p => ({ value: p.label, name: p.label }))}
      />

      {/* Base URL */}
      {needsBaseUrl && (
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
            Base URL
          </label>
          <input
            type="text"
            className={styles.integrationInput}
            value={value.baseUrl ?? ''}
            onChange={e => onChange({ ...value, baseUrl: e.target.value })}
            placeholder="http://localhost:11434"
          />
        </div>
      )}

      {/* API key */}
      {needsApiKey && (
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
            API Key
          </label>
          <input
            type="password"
            className={styles.integrationInput}
            value={value.apiKey ?? ''}
            onChange={e => onChange({ ...value, apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </div>
      )}

      {/* Model */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          {models.length > 0 ? (
            <Select
              label="Model"
              value={value.model}
              onChange={m => onChange({ ...value, model: m })}
              options={models.map(m => ({ value: m, name: m }))}
            />
          ) : (
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                Model
              </label>
              <input
                type="text"
                className={styles.integrationInput}
                value={value.model}
                onChange={e => onChange({ ...value, model: e.target.value })}
                placeholder="e.g. llama3.2"
              />
            </div>
          )}
        </div>
        <button type="button" className={styles.refreshBtn} onClick={handleRefreshModels} disabled={modelsLoading} title="Fetch model list">
          <RefreshCw className={cx(styles.refreshIcon, modelsLoading && styles.spin)} />
        </button>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={handleTest}
          title="Test connection"
          style={{ color: testStatus === 'ok' ? 'var(--color-success)' : testStatus === 'fail' ? 'var(--color-error)' : undefined }}
        >
          {testStatus === 'idle' ? '⚡' : testStatus === 'ok' ? '✓' : '✗'}
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Update SettingsView state for llmProviders**

Remove old state:
```typescript
const [ollamaHost, setOllamaHost] = useState(settings.ollamaHost);
const [conductorOllamaModel, setConductorOllamaModel] = useState(settings.conductorOllamaModel);
const [ollamaModels, setOllamaModels] = useState<string[]>([]);
const [modelsLoading, setModelsLoading] = useState(false);
const [modelsError, setModelsError] = useState('');
```

Add new state:

```typescript
const [llmProviders, setLlmProviders] = useState<UseCaseProviders>(settings.llmProviders);
```

Update the `useEffect` that syncs settings:

```typescript
useEffect(() => {
  setLlmProviders(settings.llmProviders);
  setConductorTaskTimeoutMinutes(settings.conductorTaskTimeoutMinutes);
  if (!useCustomPath) setDefaultShell(settings.shellPath || '');
}, [settings, useCustomPath]);
```

Update `handleSaveIntegrations`:

```typescript
const handleSaveIntegrations = (e: React.FormEvent) => {
  e.preventDefault();
  updateSettings({ llmProviders, conductorTaskTimeoutMinutes });
  showToast('Settings saved', 'success');
};
```

- [ ] **Step 5: Replace "Conductor Settings" card in JSX**

Find the `{/* Conductor / Ollama card */}` section and replace with:

```tsx
{/* LLM Providers card */}
<div className={styles.integrationsCard}>
  <h3 className={styles.cardTitle}>
    <Network className={cx(styles.cardTitleIcon, styles.settingsIcon)} />
    <span>LLM Providers</span>
  </h3>
  <p className={styles.cardDescription}>
    Configure the AI model used for each orchestration use case. Each use case can use a different provider and model.
    Ollama, LM Studio, OpenAI, DeepSeek, Together.ai, Anthropic, and Gemini are supported.
  </p>

  {(Object.keys(USE_CASE_LABELS) as Array<keyof UseCaseProviders>).map(key => (
    <ProviderConfigEditor
      key={key}
      label={USE_CASE_LABELS[key]}
      value={llmProviders[key]}
      onChange={cfg => setLlmProviders(prev => ({ ...prev, [key]: cfg }))}
    />
  ))}

  <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8 }}>
    <div style={{ flex: 1 }}>
      <label className={styles.formLabel}>Task Timeout (minutes)</label>
      <input
        type="number" min={1} max={480}
        className={styles.integrationInput}
        value={conductorTaskTimeoutMinutes}
        onChange={e => setConductorTaskTimeoutMinutes(Number(e.target.value))}
        style={{ width: 100 }}
      />
    </div>
    <button type="button" className={styles.amberButton} onClick={handleSaveIntegrations as any}>
      Save Provider Settings
    </button>
  </div>
</div>
```

Also remove the old "Developer Integrations & APIs" card (it contained `ollamaHost`, `openaiApiKey`, `anthropicApiKey` inputs — those are now gone). Keep only the backup card and theme card.

- [ ] **Step 6: Build check and fix remaining type errors**

```
npx tsc --noEmit
```

- [ ] **Step 7: Run all tests**

```
npx vitest run src/tests/
```

All should pass.

- [ ] **Step 8: Commit**

```
git add src/pages/Settings.tsx
git commit -m "feat(settings): replace Conductor/Ollama card with multi-provider LLM Providers UI"
```

---

### Task 16: Final integration check

- [ ] **Step 1: Run full test suite**

```
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: TypeScript clean build**

```
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 3: Start the app and verify**

```
npm run tauri dev
```

Verify:
- Settings → "General & Backups" shows "LLM Providers" card with 5 use-case sections
- Refreshing model list works for Ollama (if running locally)
- Test-connection button shows ✓/✗
- Starting a Conductor plan dispatches tasks (check log in chat panel)
- When a task completes with a sentinel, the next task dispatches automatically
- Changing provider in Settings and saving updates the active engine

- [ ] **Step 4: Final commit**

```
git add -A
git commit -m "feat: multi-provider LLM orchestration — Ollama, OpenAI-compat, Anthropic, Gemini

- Fix sentinel ANSI stripping bug (parseSentinel now strips before indexOf)
- Fix interactive prompt regex (tighter, covers Claude Code patterns)
- Add LLMProvider abstraction with OllamaProvider, OpenAICompatProvider,
  AnthropicProvider, GeminiProvider
- Per-use-case provider config: relay, planGen, autoAnswer, chat, routing
- Settings UI: LLM Providers card replaces hardwired Ollama config
- ollamaRelay.ts refactored to pure prompt builders (no HTTP)
- Legacy settings auto-migrated to new UseCaseProviders structure

Covers: LM Studio, DeepSeek, Together.ai, any OpenAI-compatible endpoint"
```
