import { invoke } from '@tauri-apps/api/core';

/**
 * Find the end index of the next chunk starting at `start`, never splitting
 * a UTF-16 surrogate pair (e.g. an emoji) across the boundary — cutting one
 * in half turns each half into a lone surrogate, which can't round-trip as
 * valid UTF-8 once it crosses the Tauri IPC boundary.
 */
function chunkEnd(data: string, start: number, chunkSize: number): number {
  let end = Math.min(start + chunkSize, data.length);
  if (end > start && end < data.length) {
    const code = data.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      // Last char of this chunk is a high surrogate — pull its low surrogate
      // in rather than leaving it stranded at the start of the next chunk.
      end += 1;
    }

    // Prevent splitting ANSI escape sequences (like \x1b[200~ or \x1b[201~) across chunks.
    // ConPTY drops escape sequences if they are split and delayed.
    let escapeIdx = -1;
    for (let j = 1; j <= 8 && (end - j) >= start; j++) {
      if (data.charCodeAt(end - j) === 0x1b) {
        escapeIdx = end - j;
        break;
      }
    }
    
    if (escapeIdx !== -1) {
      // Check if the escape sequence terminates before `end`.
      let terminated = false;
      for (let k = escapeIdx + 1; k < end; k++) {
        if (/[a-zA-Z~]/.test(data[k])) {
          terminated = true;
          break;
        }
      }
      
      // If unterminated, pull boundary back to before the ESC character
      // (as long as it doesn't cause an empty chunk).
      if (!terminated && escapeIdx > start) {
        end = escapeIdx;
      }
    }
  }
  return end;
}

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
  let i = 0;
  while (i < data.length) {
    const end = chunkEnd(data, i, chunkSize);
    const chunk = data.slice(i, end);
    await invoke('write_pty', { sessionId, data: chunk });
    if (end < data.length) {
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
    i = end;
  }
}
