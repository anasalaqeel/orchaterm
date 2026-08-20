import { describe, it, expect } from 'vitest';
import { buildPromptContext, formatTerminalWrite, TerminalLike } from '../utils/quickActionInject';
import { interpolatePromptTemplate } from '../utils/promptTemplate';

/** Minimal xterm-shaped terminal double. */
function makeTerm(
  opts: {
    selection?: string;
    lines?: string[];
    bracketedPasteMode?: boolean;
  } = {}
): TerminalLike {
  const lines = opts.lines ?? [];
  return {
    hasSelection: () => (opts.selection ?? '') !== '',
    getSelection: () => opts.selection ?? '',
    modes: { bracketedPasteMode: opts.bracketedPasteMode ?? true },
    buffer: {
      active: {
        length: lines.length,
        getLine: (row: number) =>
          lines[row] !== undefined
            ? {
                translateToString: (trimRight: boolean) =>
                  trimRight ? lines[row].trimEnd() : lines[row],
              }
            : undefined,
      },
    },
  } as TerminalLike;
}

describe('formatTerminalWrite', () => {
  it('wraps auto-run text in bracketed-paste markers with Enter outside', () => {
    expect(formatTerminalWrite('git status', true, true)).toBe('\x1b[200~git status\x1b[201~\r');
  });

  it('wraps paste-only text without a trailing Enter', () => {
    expect(formatTerminalWrite('git status', false, true)).toBe('\x1b[200~git status\x1b[201~');
  });

  it('sends raw text plus Enter when the shell lacks bracketed paste', () => {
    expect(formatTerminalWrite('git status', true, false)).toBe('git status\r');
    expect(formatTerminalWrite('git status', false, false)).toBe('git status');
  });

  it('keeps embedded newlines inside the markers and appends Enter after the closing marker', () => {
    // A multi-line payload: the embedded \r\n must remain INSIDE the
    // 200~/201~ pair (bracketed paste treats it as literal content, not
    // "run now"); only the execute key goes after \x1b[201~.
    const payload = formatTerminalWrite('line one\r\nline two', true, true);
    expect(payload).toBe('\x1b[200~line one\r\nline two\x1b[201~\r');
    // Invariant form: nothing may follow the closing marker except one \r.
    expect(payload.endsWith('\x1b[201~\r')).toBe(true);
    expect(payload.slice(0, -1).endsWith('\x1b[201~')).toBe(true);
  });
});

describe('buildPromptContext', () => {
  const source = {
    workspaces: [
      { id: 'w1', name: 'Orchaterm', path: 'C:\\dev\\orchaterm' },
      { id: 'w2', name: 'Other', path: 'C:\\dev\\other' },
    ],
    spaces: [{ id: 's1', name: 'Frontend Team' }],
    activeWorkspaceId: 'w1',
    activeSpaceId: 's1',
    fallbackWorkspacePath: 'C:\\fallback',
  };

  it('collects selection, buffer, workspace and space', () => {
    const term = makeTerm({
      selection: 'npm ERR!',
      lines: ['$ npm run buld', 'npm ERR! missing script'],
    });
    expect(buildPromptContext(term, source)).toEqual({
      selection: 'npm ERR!',
      terminalOutput: '$ npm run buld\nnpm ERR! missing script',
      workspaceName: 'Orchaterm',
      workspacePath: 'C:\\dev\\orchaterm',
      spaceName: 'Frontend Team',
    });
  });

  it('yields an empty selection when nothing is highlighted', () => {
    const ctx = buildPromptContext(makeTerm({ lines: ['output'] }), source);
    expect(ctx.selection).toBe('');
  });

  it('falls back to the tab workspace path when no active workspace resolves', () => {
    const ctx = buildPromptContext(null, { ...source, activeWorkspaceId: 'gone' });
    expect(ctx.workspacePath).toBe('C:\\fallback');
    expect(ctx.workspaceName).toBeUndefined();
  });

  it('tolerates a null terminal (no selection, no buffer)', () => {
    expect(buildPromptContext(null, source)).toEqual({
      selection: '',
      terminalOutput: '',
      workspaceName: 'Orchaterm',
      workspacePath: 'C:\\dev\\orchaterm',
      spaceName: 'Frontend Team',
    });
  });
});

describe('quick action composition (context → interpolation → write format)', () => {
  it('expands {{terminal_output}} into the payload without auto-executing', () => {
    const term = makeTerm({ lines: ['npm ERR! missing script: buld'] });
    const ctx = buildPromptContext(term, {
      workspaces: [],
      spaces: [],
      activeWorkspaceId: null,
      activeSpaceId: null,
    });
    const text = interpolatePromptTemplate(
      'Explain this error:\n```\n{{terminal_output}}\n```',
      ctx
    );
    expect(formatTerminalWrite(text, false, true)).toBe(
      '\x1b[200~Explain this error:\n```\nnpm ERR! missing script: buld\n```\x1b[201~'
    );
  });

  it('passes variable-free actions through byte-identical', () => {
    const text = interpolatePromptTemplate(
      'git status',
      buildPromptContext(makeTerm(), {
        workspaces: [],
        spaces: [],
      })
    );
    expect(formatTerminalWrite(text, true, true)).toBe('\x1b[200~git status\x1b[201~\r');
  });
});
