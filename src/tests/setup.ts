import { vi } from 'vitest';

// Mock @tauri-apps/api/core so services that import invoke don't crash in tests.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock @tauri-apps/api/event — bufferWatcher uses listen()
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// jsdom does not implement ResizeObserver (browser-only API). Components
// under test (TerminalTab, QuickActionsBar) construct one at mount; stub the
// environment gap so rendering works. Observing behavior is not under test.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does not implement the CSS Font Loading API (document.fonts).
// TerminalTab awaits document.fonts.ready after mount; stub the environment
// gap with an already-resolved FontFaceSet-like object.
if (!('fonts' in document)) {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
}

// jsdom does not implement Element.scrollIntoView. Settings scrolls to the
// quick-actions section when opened with #terminal; stub the gap.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}

// Node 22+ ships an experimental global `localStorage`/`sessionStorage`.
// jsdom detects that global and defers to it instead of providing its own
// working implementation — but without `--localstorage-file` the Node one is
// inert (`undefined`), so both `localStorage` and `window.localStorage` end
// up unusable. Polyfill a minimal in-memory Storage so persistence code
// (agentStats, settings, etc.) works the same in tests regardless of the
// Node version or flags the test runner happens to be invoked with.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

for (const key of ['localStorage', 'sessionStorage'] as const) {
  let usable = false;
  try {
    usable = typeof (globalThis as any)[key]?.clear === 'function';
  } catch {
    usable = false;
  }
  if (!usable) {
    const storage = createMemoryStorage();
    Object.defineProperty(globalThis, key, { configurable: true, value: storage });
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, key, { configurable: true, value: storage });
    }
  }
}
