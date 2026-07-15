import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { writePtyChunked } from '../utils/ptyUtils';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const mockedInvoke = vi.mocked(invoke);

describe('writePtyChunked', () => {
  beforeEach(() => {
    mockedInvoke.mockClear();
  });

  function sentChunks(): string[] {
    return mockedInvoke.mock.calls.map((call) => (call[1] as { data: string }).data);
  }

  it('sends short data in a single call', async () => {
    await writePtyChunked('s1', 'claude --dangerously-skip-permissions\r', 80, 0);
    expect(sentChunks()).toEqual(['claude --dangerously-skip-permissions\r']);
  });

  it('splits long data into multiple chunks', async () => {
    const data = 'a'.repeat(200);
    await writePtyChunked('s1', data, 80, 0);
    const chunks = sentChunks();
    expect(chunks).toEqual(['a'.repeat(80), 'a'.repeat(80), 'a'.repeat(40)]);
    expect(chunks.join('')).toBe(data);
  });

  it('never splits a surrogate pair across a chunk boundary', async () => {
    // Pad so the emoji (a surrogate pair, U+1F389) straddles the default
    // 80-char boundary: 79 'a's + emoji lands the high surrogate at index 79
    // (last char of the first naive 80-char slice) and the low surrogate at
    // index 80 (first char of the next slice) if split naively.
    const data = 'a'.repeat(79) + '\u{1F389}' + 'b'.repeat(10);
    await writePtyChunked('s1', data, 80, 0);
    const chunks = sentChunks();
    for (const chunk of chunks) {
      // A lone surrogate (mismatched high/low) means the pair was split.
      expect(chunk).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
      expect(chunk).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
    }
    expect(chunks.join('')).toBe(data);
  });
});
