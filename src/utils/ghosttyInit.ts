import { Ghostty } from 'ghostty-web';
// Vite emits the WASM binary as a fetchable asset URL. The `?url` suffix is the
// documented way to obtain that URL for both `vite dev` and the production
// build, and it sidesteps ghostty-web's own `import.meta.url`-based resolution
// (which is unreliable inside a bundled module graph / Tauri asset origin).
import wasmUrl from 'ghostty-web/ghostty-vt.wasm?url';

let ghosttyPromise: Promise<Ghostty> | null = null;

/**
 * Loads the Ghostty WASM VT core exactly once per app session and returns the
 * shared instance. Every Terminal is constructed with this instance
 * (`new Terminal({ ghostty })`); ghostty-web wires the rest.
 *
 * Must be awaited before the first `new Terminal(...)`. A failed load is not
 * cached, so a later call can retry.
 */
export function ensureGhostty(): Promise<Ghostty> {
  if (!ghosttyPromise) {
    ghosttyPromise = Ghostty.load(wasmUrl).catch((err) => {
      ghosttyPromise = null; // allow retry instead of caching the rejection
      throw err;
    });
  }
  return ghosttyPromise;
}
