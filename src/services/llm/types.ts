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
  /**
   * Available model names. MAY reject with an Error describing why listing
   * failed (e.g. bad API key, timeout) so callers can surface the reason to
   * the user — callers must catch. Providers that cannot enumerate models
   * (or choose to fail soft, e.g. Ollama) resolve [] instead.
   */
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
