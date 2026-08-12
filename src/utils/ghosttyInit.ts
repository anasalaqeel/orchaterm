import { Ghostty } from 'ghostty-web';

let ghosttyPromise: Promise<Ghostty> | null = null;

/**
 * Loads the Ghostty WASM VT core exactly once per app session and returns the
 * shared instance. Every Terminal is constructed with this instance
 * (`new Terminal({ ghostty })`).
 *
 * Called with NO argument on purpose. ghostty-web inlines the wasm as a
 * `data:application/wasm;base64,…` URL inside its JS bundle, and `Ghostty.load()`
 * (no path) instantiates straight from that — fully self-contained, no external
 * asset to fetch or resolve. Passing a URL instead forces its Bun→fs→fetch
 * loader onto a *real* path, which fails to resolve inside the Tauri WebView
 * (and leaves the terminal pane blank). Must be awaited before the first
 * `new Terminal(...)`. A failed load is not cached, so a later call can retry.
 */
export function ensureGhostty(): Promise<Ghostty> {
  if (!ghosttyPromise) {
    ghosttyPromise = Ghostty.load().catch((err) => {
      ghosttyPromise = null; // allow retry instead of caching the rejection
      throw err;
    });
  }
  return ghosttyPromise;
}
