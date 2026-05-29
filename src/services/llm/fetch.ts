import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

export const customFetch: typeof fetch = (input, init) => {
  if (isTauri) {
    return tauriFetch(input, init);
  }
  return fetch(input, init);
};
