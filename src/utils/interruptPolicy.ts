import { InterruptPolicy } from '../types';

/** Shell and agent prompt patterns we recognise as safe injection points. */
const PROMPT_PATTERNS: RegExp[] = [
  /\$\s*$/,   // bash/sh: ends with "$" + optional space
  />\s*$/,    // PowerShell/cmd: ends with ">" + optional space
  /❯\s*$/,   // zsh/oh-my-zsh: ends with "❯" + optional space
  /%\s*$/,   // tcsh/zsh: ends with "%" + optional space
  /#\s*$/,   // root shell
];

/** Strips ANSI escape sequences so prompts inside coloured output are found. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b./g, '');
}

/**
 * Returns true if it is safe to auto-inject a message into a terminal
 * session right now, based on the session's interrupt policy and its
 * current buffer content.
 */
export function canInjectNow(buffer: string, policy: InterruptPolicy): boolean {
  if (policy === 'always') return true;
  if (policy === 'never')  return false;

  // 'prompt-only': check last few non-empty lines for a known prompt.
  const clean = stripAnsi(buffer);
  const lastChunk = clean.split('\n').filter(l => l.trim()).slice(-5).join('\n');
  if (!lastChunk) return false;
  return PROMPT_PATTERNS.some(p => p.test(lastChunk));
}
