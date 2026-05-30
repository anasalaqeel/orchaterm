import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

/**
 * Local model servers (Ollama, LM Studio, …) CORS-check the request Origin.
 * In dev the webview origin is http://localhost:1420 (allowed by default); in a
 * packaged Tauri app it's http://tauri.localhost, which Ollama rejects with 403.
 * For local hosts we override Origin to a value these servers allow by default,
 * so the production build works without the user setting OLLAMA_ORIGINS.
 * Cloud providers (OpenAI, Anthropic, …) ignore Origin, so we leave them alone.
 */
function isLocalHost(url: string): boolean {
  try {
    const host = new URL(url, 'http://localhost').hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1';
  } catch {
    return false;
  }
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export const customFetch: typeof fetch = (input, init) => {
  if (!isTauri) return fetch(input, init);

  if (isLocalHost(resolveUrl(input))) {
    const headers = new Headers(init?.headers);
    headers.set('Origin', 'http://localhost');
    return tauriFetch(input, { ...init, headers });
  }

  return tauriFetch(input, init);
};
