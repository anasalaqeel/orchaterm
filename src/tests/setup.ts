import { vi } from 'vitest';

// Mock @tauri-apps/api/core so services that import invoke don't crash in tests.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock @tauri-apps/api/event — bufferWatcher uses listen()
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
