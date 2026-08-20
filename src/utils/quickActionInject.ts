/**
 * quickActionInject.ts
 *
 * Pure helpers behind the Quick Actions injection path. TerminalTab wires
 * these together: buildPromptContext → interpolatePromptTemplate →
 * formatTerminalWrite → writePtyChunked. Keeping them here (free of xterm,
 * React, and Tauri) makes the injection behaviour unit-testable.
 */

import { extractTerminalBuffer } from './promptTemplate';
import type { PromptContext } from './promptTemplate';

/** Minimal structural slice of an xterm Terminal instance. */
export interface TerminalLike {
  hasSelection(): boolean;
  getSelection(): string;
  modes: { bracketedPasteMode: boolean };
  buffer: {
    active: {
      length: number;
      getLine(row: number): { translateToString(trimRight: boolean): string } | undefined;
    };
  };
}

/** Dashboard state needed to resolve workspace/space context. */
export interface QuickActionContextSource {
  workspaces: Array<{ id: string; name: string; path: string }>;
  spaces: Array<{ id: string; name: string }>;
  activeWorkspaceId?: string | null;
  activeSpaceId?: string | null;
  /** Tab-level workspace path, used when no active workspace resolves. */
  fallbackWorkspacePath?: string;
}

/**
 * Gather live terminal context for template variables:
 * the current selection, the recent output buffer, and workspace/space info.
 */
export function buildPromptContext(
  term: TerminalLike | null,
  source: QuickActionContextSource
): PromptContext {
  const activeWorkspace = source.workspaces.find((w) => w.id === source.activeWorkspaceId);
  const activeSpace = source.spaces.find((s) => s.id === source.activeSpaceId);

  return {
    selection: term && term.hasSelection() ? term.getSelection() : '',
    terminalOutput: extractTerminalBuffer(term),
    workspaceName: activeWorkspace?.name,
    workspacePath: activeWorkspace?.path || source.fallbackWorkspacePath,
    spaceName: activeSpace?.name,
  };
}

/**
 * Wrap interpolated text for writing into the PTY.
 *
 * Enter must sit outside the closing bracketed-paste marker: bracketed paste
 * treats an embedded \r as a literal newline in the line buffer, not "run
 * this now" (that's what stops a pasted multi-line script from
 * auto-executing), so the execute key has to be appended after `\x1b[201~`.
 * When the shell doesn't speak bracketed paste, the raw text is sent with \r
 * (if auto-executing) so it still runs.
 */
export function formatTerminalWrite(
  text: string,
  autoExecute: boolean,
  bracketedPasteMode: boolean
): string {
  const bracketed = bracketedPasteMode ? `\x1b[200~${text}\x1b[201~` : text;
  return autoExecute ? `${bracketed}\r` : bracketed;
}
