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
