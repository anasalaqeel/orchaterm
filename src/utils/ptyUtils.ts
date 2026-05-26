import { invoke } from '@tauri-apps/api/core';

/**
 * Write a potentially large string to a PTY session in small chunks with
 * brief delays between each chunk.
 *
 * Why: Windows ConPTY and readline-based CLIs (e.g. Claude Code CLI) can
 * silently drop characters when a large buffer is written in a single atomic
 * call. Chunking gives the receiving process time to drain its input buffer
 * before the next chunk arrives, preventing data loss.
 *
 * @param sessionId  PTY session ID
 * @param data       Full string to write (may include '\n')
 * @param chunkSize  Characters per chunk (default 80)
 * @param delayMs    Milliseconds between chunks (default 8)
 */
export async function writePtyChunked(
  sessionId: string,
  data: string,
  chunkSize = 80,
  delayMs = 8,
): Promise<void> {
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    await invoke('write_pty', { sessionId, data: chunk });
    if (i + chunkSize < data.length) {
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
  }
}
