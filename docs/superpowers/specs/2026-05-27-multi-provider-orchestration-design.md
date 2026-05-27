# Multi-Provider Orchestration + Bug Fixes — Design Spec

**Date:** 2026-05-27  
**Status:** Approved for implementation

---

## Problem Statement

Two categories of work:

1. **Orchestration is broken.** Two confirmed bugs:
   - Sentinel never fires after agent task completion → engine hangs indefinitely
   - Auto-answer does not fire when agent is stuck on interactive prompt

2. **Only Ollama supported.** All LLM calls hardwired to Ollama's `/api/chat` endpoint. OpenAI keys stored in settings but never used as orchestrator. No LM Studio, DeepSeek, Together.ai, Anthropic, or Gemini support.

---

## Bug Fixes

### Bug 1 — Sentinel detection (ANSI stripping)

**File:** `src/services/sentinelParser.ts`, `parseSentinel()`

**Root cause:** `parseSentinel` searches the raw ANSI-encoded buffer with `buffer.indexOf(SENTINEL_START)`. Claude Code wraps streaming output in ANSI escape codes. If any escape sequence lands inside or adjacent to `###ORCHATERM_DONE###`, the `indexOf` call fails silently.

**Compare:** `parsePlanBlock` correctly calls `stripAnsiCodes(buffer)` before searching. `parseSentinel` does not.

**Fix:** Strip ANSI codes from the buffer before searching for sentinel markers. The existing `stripAnsiCodes()` utility is already present — call it at the top of `parseSentinel`.

```typescript
export function parseSentinel(rawBuffer: string): OrchestratorTaskOutput | null {
  const buffer = stripAnsiCodes(rawBuffer);  // ← ADD THIS
  const startIdx = buffer.indexOf(SENTINEL_START);
  ...
}
```

The `raw` field returned in `OrchestratorTaskOutput` should still be `stripAnsiCodes(rawBuffer.slice(0, startIdx))` — same as today but now computed from the cleaned buffer.

### Bug 2 — Interactive prompt detection

**File:** `src/services/bufferWatcher.ts`, `checkInteractivePrompt()`

**Root cause:** The regex is too narrow for Claude Code's actual prompt formats and the fallback to Ollama silently fails when Ollama is offline.

**Fix — regex:**
```typescript
const INTERACTIVE_PROMPT_REGEX =
  /(\[y\/n\]|\(y\/n\)|\[Y\/n\]|\(Y\/n\)|\[n\/Y\]|\(n\/Y\)|Do you want to|Press Enter|Continue\?|Select an option|Type a number|\?\s*$)/i;
```

**Fix — provider:** Once the provider layer exists, auto-answer uses the `autoAnswer` provider from settings instead of hardcoded Ollama. See engine changes below.

---

## Architecture: LLM Provider Abstraction

### New directory: `src/services/llm/`

```
src/services/llm/
  types.ts                  ← LLMProvider interface, ProviderConfig, ChatMessage, StreamCallbacks
  OllamaProvider.ts         ← /api/chat + /api/tags (existing logic migrated)
  OpenAICompatProvider.ts   ← /v1/chat/completions + /v1/models (OpenAI, LM Studio, DeepSeek, Together.ai)
  AnthropicProvider.ts      ← Anthropic Messages API (/v1/messages)
  GeminiProvider.ts         ← Google AI API (generateContent)
  providerFactory.ts        ← createProvider(config): LLMProvider
  index.ts                  ← re-exports
```

### Core interface (`types.ts`)

```typescript
export type ProviderType = 'ollama' | 'openai-compatible' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
  baseUrl?: string;   // ollama default: http://localhost:11434
                      // openai-compat default: https://api.openai.com
                      // override for LM Studio: http://localhost:1234
                      // override for DeepSeek: https://api.deepseek.com
                      // override for Together: https://api.together.xyz
  apiKey?: string;    // openai-compat, anthropic, gemini
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
  /** Non-streaming call. Rejects on network error or empty response. */
  complete(messages: ChatMessage[], systemPrompt?: string): Promise<string>;
  /** Streaming call. Returns a cancel function. */
  stream(messages: ChatMessage[], systemPrompt: string, callbacks: StreamCallbacks): () => void;
  /** Returns available model names. Empty array if provider can't list models. */
  listModels(): Promise<string[]>;
  /** Quick liveness check. Resolves true/false, never throws. */
  checkOnline(): Promise<boolean>;
}
```

### Provider implementations

**`OllamaProvider`** — wraps existing `/api/chat` and `/api/tags` logic from `ollamaRelay.ts`. Non-streaming uses `stream: false`. Streaming uses `stream: true` with NDJSON parsing.

**`OpenAICompatProvider`** — uses `/v1/chat/completions` (POST) and `/v1/models` (GET). Works for:
- OpenAI (`baseUrl: https://api.openai.com`, `apiKey: sk-...`)
- LM Studio (`baseUrl: http://localhost:1234`, no apiKey)
- DeepSeek (`baseUrl: https://api.deepseek.com`, `apiKey: ...`)
- Together.ai (`baseUrl: https://api.together.xyz`, `apiKey: ...`)
- Any custom OpenAI-compatible endpoint

Streaming uses SSE (`data: {...}` lines with `[DONE]` terminator).

**`AnthropicProvider`** — uses `/v1/messages`. System prompt mapped to Anthropic's `system` top-level field. Streaming uses SSE with `content_block_delta` events. `listModels()` returns hardcoded list (Anthropic has no public model-list endpoint). `checkOnline()` does a HEAD to `/v1/models` with the api-version header.

**`GeminiProvider`** — uses `generateContent` REST endpoint. Maps messages to Gemini's `contents` format (role `user`/`model`). `listModels()` calls `/v1/models`. Streaming uses `streamGenerateContent`.

### `providerFactory.ts`

```typescript
export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'ollama':            return new OllamaProvider(config);
    case 'openai-compatible': return new OpenAICompatProvider(config);
    case 'anthropic':         return new AnthropicProvider(config);
    case 'gemini':            return new GeminiProvider(config);
  }
}
```

---

## Settings Schema Changes

### `AppSettings` (`src/types/workspace.types.ts`)

```typescript
export interface UseCaseProviders {
  relay:      ProviderConfig;   // task handoff summarization (relay + merge relay)
  planGen:    ProviderConfig;   // NL → task plan, needs resolution, intent classification
  autoAnswer: ProviderConfig;   // interactive prompt auto-answering
  chat:       ProviderConfig;   // GroupChat streaming conversation
  routing:    ProviderConfig;   // autonomous agent routing + terminal summarization
}

export interface AppSettings {
  shellPath: string;
  conductorTaskTimeoutMinutes: number;
  llmProviders: UseCaseProviders;
  // Legacy fields kept for migration only (read on load, not written):
  ollamaHost?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  conductorOllamaModel?: string;
}
```

### Migration in `DashboardContext`

On load, if `llmProviders` is absent (old settings), construct defaults from legacy fields:

```typescript
const defaultOllamaConfig: ProviderConfig = {
  provider: 'ollama',
  model: legacySettings.conductorOllamaModel || 'llama3.2',
  baseUrl: legacySettings.ollamaHost || 'http://localhost:11434',
};
llmProviders = {
  relay:      { ...defaultOllamaConfig },
  planGen:    { ...defaultOllamaConfig },
  autoAnswer: { ...defaultOllamaConfig },
  chat:       { ...defaultOllamaConfig },
  routing:    { ...defaultOllamaConfig },
};
```

---

## Engine Changes

### `OrchestratorEngine`

**`EngineConfig`** replaces `ollamaHost`/`ollamaModel` with provider instances:

```typescript
export interface EngineConfig {
  relayProvider:      LLMProvider;
  planGenProvider:    LLMProvider;
  autoAnswerProvider: LLMProvider;
  taskTimeoutMinutes: number;
  sessionTitles: Map<string, string>;
}
```

All calls to `relayViaOllama`, `mergeAndRelayViaOllama`, `checkOllamaOnline`, `autoAnswerInteractivePrompt` replaced with calls to the injected providers.

`ollamaRelay.ts` functions (`relayViaOllama`, etc.) are rewritten to accept a `LLMProvider` + prompts instead of `ollamaHost`/`model`. The raw HTTP code moves into each `Provider` implementation.

### `AutonomousOrchestrator`

```typescript
updateConfig(config: { routingProvider: LLMProvider; chatProvider: LLMProvider }): void
```

`evaluateAndRoute`, `summariseChunk` calls replaced with `routingProvider.complete(...)`.
`streamChatWithOllama` replaced with `chatProvider.stream(...)`.

### `DashboardContext` wires providers to engines

When `settings.llmProviders` changes:
```typescript
orchestratorEngine.updateConfig({
  relayProvider:      createProvider(settings.llmProviders.relay),
  planGenProvider:    createProvider(settings.llmProviders.planGen),
  autoAnswerProvider: createProvider(settings.llmProviders.autoAnswer),
  ...
});
autonomousOrchestrator.updateConfig({
  routingProvider: createProvider(settings.llmProviders.routing),
  chatProvider:    createProvider(settings.llmProviders.chat),
});
```

---

## `ollamaRelay.ts` Refactor

The file is refactored to contain pure prompt-building functions (no HTTP):
- `buildRelayPrompt(...)` → returns `{ system, user }` message objects
- `buildMergeRelayPrompt(...)` → same
- `buildPlanGenPrompt(...)` → same
- `buildAutoAnswerPrompt(...)` → same
- `buildRoutingPrompt(...)` → same
- `buildSummarisePrompt(...)` → same
- `buildPassThroughBrief(...)` → kept as-is (no LLM needed)

Each engine function calls the prompt builder, then calls `provider.complete(messages, systemPrompt)`.

`fetchOllamaModels` and `checkOllamaOnline` → moved into `OllamaProvider`.

---

## Settings UI Changes (`src/pages/Settings.tsx`)

Replace the "Conductor / Ollama" card with a new **"LLM Providers"** card.

Five collapsible sections, one per use case: **Relay · Plan Generation · Auto-Answer · Chat · Routing**

Each section contains:
1. **Provider dropdown:** Ollama | LM Studio | OpenAI | Anthropic | Gemini | Custom (OpenAI-compatible)
   - "LM Studio" pre-fills `baseUrl: http://localhost:1234` and hides apiKey
   - "Custom" shows both baseUrl and apiKey
2. **Base URL input** (shown for: Ollama, LM Studio, Custom)
3. **API Key input** (shown for: OpenAI, Anthropic, Gemini, Custom; password type)
4. **Model field**: text input + optional "Refresh" button to call `provider.listModels()` and show a dropdown
5. **Test** button: calls `provider.checkOnline()`, shows ✓ or ✗ inline

**"Copy from..."** dropdown at top of each section: copies another use case's config as a starting point. Common case: set relay, then copy to planGen/autoAnswer/routing.

**Save** still one button per card (not per use-case) to match existing UX.

---

## File Change Summary

| File | Change |
|------|--------|
| `src/services/llm/types.ts` | NEW — interface + config types |
| `src/services/llm/OllamaProvider.ts` | NEW — Ollama implementation |
| `src/services/llm/OpenAICompatProvider.ts` | NEW — OpenAI-compatible implementation |
| `src/services/llm/AnthropicProvider.ts` | NEW — Anthropic implementation |
| `src/services/llm/GeminiProvider.ts` | NEW — Gemini implementation |
| `src/services/llm/providerFactory.ts` | NEW — factory function |
| `src/services/llm/index.ts` | NEW — re-exports |
| `src/services/sentinelParser.ts` | FIX — strip ANSI before sentinel indexOf |
| `src/services/bufferWatcher.ts` | FIX — improved interactive prompt regex |
| `src/services/ollamaRelay.ts` | REFACTOR — pure prompt builders, no HTTP |
| `src/services/orchestratorEngine.ts` | MODIFY — inject providers, use prompt builders |
| `src/services/autonomousOrchestrator.ts` | MODIFY — inject providers |
| `src/types/workspace.types.ts` | MODIFY — new AppSettings with UseCaseProviders |
| `src/context/DashboardContext.tsx` | MODIFY — migration logic, wire providers to engines |
| `src/pages/Settings.tsx` | MODIFY — new LLM Providers UI |

---

## Error Handling

- `LLMProvider.complete()` throws on failure. Callers catch and use pass-through briefs (existing behavior).
- `LLMProvider.checkOnline()` never throws — always resolves true/false.
- `LLMProvider.listModels()` returns `[]` on failure — UI shows empty model list gracefully.
- If `autoAnswer` provider is offline, falls back to user-override log message (existing behavior).

---

## Out of Scope

- Streaming plan generation (plan always non-streaming)
- Provider-level retry logic
- Token counting / cost tracking
- Model capability validation (e.g. context window)
