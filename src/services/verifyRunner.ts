/**
 * verifyRunner.ts
 *
 * Runs a task's verify command in a short-lived hidden PTY spawned in the
 * workspace directory — never in the agent's own terminal, where typing a
 * shell command into a finished TUI agent (e.g. Claude Code) would be
 * interpreted as a new user message.
 *
 * The command is appended with an exit-code marker so the pass/fail decision
 * comes from the shell's exit status, not from parsing command output.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { stripAnsiCodes } from './sentinelParser';

const EXIT_MARKER = 'ORCHATERM_VERIFY_EXIT_';
/** How long to wait for the shell to reach a prompt before sending the command. */
const SHELL_READY_TIMEOUT_MS = 5_000;
/** Hard cap for the whole verification (command included). */
const VERIFY_TIMEOUT_MS = 120_000;
/** Prompt patterns indicating the hidden shell is ready for input. */
const PROMPT_REGEX = /[$%#>❯]\s*$/;

export interface VerifyResult {
  passed: boolean;
  /** Last ~4000 chars of ANSI-stripped output, for logs and the task output. */
  output: string;
}

/** Cap on retained output — a chatty test suite must not make the 100ms
 * polling loop below strip ANSI over an ever-growing megabyte buffer. */
const MAX_BUFFER_CHARS = 64 * 1024;

interface PtyPayload {
  session_id: string;
  data: string;
}

/**
 * Spawns a hidden shell in `workspacePath`, runs `command`, and resolves with
 * the shell exit status. Always kills the hidden PTY before resolving; a
 * timeout resolves as a failed result (with the reason in `output`) rather
 * than rejecting — a verification that cannot run is a verification outcome.
 */
export async function runVerifyCommand(
  workspacePath: string,
  command: string
): Promise<VerifyResult> {
  const sessionId = `verify-${crypto.randomUUID()}`;
  let buffer = '';
  let unlisten: (() => void) | null = null;
  let commandSent = false;

  const cleanup = async () => {
    if (unlisten) unlisten();
    await invoke('kill_pty', { sessionId }).catch(() => {});
  };

  const tail = () => stripAnsiCodes(buffer).slice(-4000).trim();

  try {
    unlisten = await listen<PtyPayload>(`pty-data-${sessionId}`, (event) => {
      buffer += event.payload.data;
      if (buffer.length > MAX_BUFFER_CHARS) buffer = buffer.slice(-MAX_BUFFER_CHARS);
    });
    await invoke('spawn_pty', {
      sessionId,
      workspacePath,
      cols: 80,
      rows: 24,
    });

    // Wait for the shell to reach its first prompt (or give up waiting and
    // send anyway — the command simply buffers in the tty input queue).
    const shellReadyAt = Date.now() + SHELL_READY_TIMEOUT_MS;
    while (Date.now() < shellReadyAt) {
      if (PROMPT_REGEX.test(stripAnsiCodes(buffer).slice(-200))) break;
      await sleep(100);
    }

    // The exit-code marker must match the hidden shell's language: PowerShell
    // on Windows (spawn_pty's default there), POSIX sh elsewhere. $? semantics:
    // PS's $? is a bool, so it is converted to 0/1 via [int](-not $?).
    const isWindows = typeof navigator !== 'undefined' && /^Win/i.test(navigator.platform);
    const wrappedCommand = isWindows
      ? `${command}; Write-Output ('${EXIT_MARKER}' + [int](-not $?))`
      : `${command}; printf '\\n${EXIT_MARKER}%s\\n' "$?"`;

    await invoke('write_pty', {
      sessionId,
      data: `${wrappedCommand}\r`,
    });
    commandSent = true;

    const deadline = Date.now() + VERIFY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const match = stripAnsiCodes(buffer).match(new RegExp(`${EXIT_MARKER}(\\d+)`));
      if (match) {
        // Give the marker print a moment to finish, then judge the exit code.
        const code = parseInt(match[1], 10);
        await sleep(150);
        return { passed: code === 0, output: tail() };
      }
      await sleep(100);
    }

    return commandSent
      ? {
          passed: false,
          output: `${tail()}\n[verification timed out after ${VERIFY_TIMEOUT_MS / 1000}s]`,
        }
      : { passed: false, output: '[verification never ran — hidden shell did not start]' };
  } finally {
    await cleanup();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
