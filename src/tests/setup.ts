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
