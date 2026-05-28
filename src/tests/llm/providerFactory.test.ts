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
