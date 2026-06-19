import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { bufferWatcher } from '../services/bufferWatcher';

// setup.ts already mocks listen() to a vi.fn — override its implementation so we
// can capture the per-session pty-data callback and feed synthetic output.
const listeners: Record<string, (e: any) => void> = {};

beforeEach(() => {
  vi.mocked(listen).mockImplementation(((name: string, cb: any) => {
    listeners[name] = cb;
    return Promise.resolve(() => { delete listeners[name]; });
  }) as any);
});

function feed(sid: string, data: string): void {
  listeners[`pty-data-${sid}`]?.({ payload: { session_id: sid, data } });
}

const CAP = 256 * 1024; // must match MAX_BUFFER_CHARS in bufferWatcher.ts

let counter = 0;
const nextSid = (p: string) => `${p}-${counter++}`;

describe('bufferWatcher buffer cap', () => {
  it('caps the retained buffer at the limit and keeps the most-recent tail', async () => {
    const sid = nextSid('cap');
    await bufferWatcher.watchForNeeds(sid, () => {});

    feed(sid, 'X'.repeat(300 * 1024)); // single chunk already over the cap
    feed(sid, 'END');                  // newest bytes — must survive

    const buf = bufferWatcher.getBuffer(sid);
    expect(buf.length).toBe(CAP);      // bounded, not unbounded
    expect(buf.endsWith('END')).toBe(true); // tail (recent output) retained

    bufferWatcher.unwatch(sid);
  });

  it('grows across chunks but never exceeds the cap', async () => {
    const sid = nextSid('grow');
    await bufferWatcher.watchForNeeds(sid, () => {});

    for (let i = 0; i < 10; i++) feed(sid, 'A'.repeat(64 * 1024)); // 640 KiB total

    expect(bufferWatcher.getBuffer(sid).length).toBe(CAP);
    bufferWatcher.unwatch(sid);
  });

  it('does not trim when under the cap', async () => {
    const sid = nextSid('small');
    await bufferWatcher.watchForNeeds(sid, () => {});

    feed(sid, 'hello world');
    expect(bufferWatcher.getBuffer(sid)).toBe('hello world');

    bufferWatcher.unwatch(sid);
  });
});
