import { describe, it, expect } from 'vitest';
import { searchBuffer, revealMatch } from '../utils/terminalSearch';

/**
 * Minimal fake of the ghostty-web Terminal surface that searchBuffer/revealMatch
 * touch: `buffer.active.length`, `getLine(y).translateToString(trimRight)`,
 * `select(col,row,len)` and `scrollToLine(line)`. Good enough to unit-test the
 * search logic without spinning up the WASM core.
 */
function fakeTerm(lines: string[]) {
  const calls: { select?: [number, number, number]; scrollToLine?: number } = {};
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine: (y: number) =>
          y >= 0 && y < lines.length
            ? {
                translateToString: (trimRight = true) =>
                  trimRight ? lines[y].replace(/\s+$/, '') : lines[y],
              }
            : undefined,
      },
    },
    select: (col: number, row: number, length: number) => {
      calls.select = [col, row, length];
    },
    scrollToLine: (line: number) => {
      calls.scrollToLine = line;
    },
    _calls: calls,
  } as any;
}

describe('searchBuffer', () => {
  it('empty query → no matches', () => {
    expect(searchBuffer(fakeTerm(['hello']), '')).toEqual([]);
  });

  it('finds a single literal match (case-insensitive) at the right cell', () => {
    const t = fakeTerm(['hello world']);
    const m = searchBuffer(t, 'WORLD');
    expect(m).toEqual([{ row: 0, col: 6, length: 5 }]);
  });

  it('finds multiple matches on one line, left to right', () => {
    const t = fakeTerm(['foo bar foo']);
    const m = searchBuffer(t, 'foo');
    expect(m).toEqual([
      { row: 0, col: 0, length: 3 },
      { row: 0, col: 8, length: 3 },
    ]);
  });

  it('finds matches across multiple rows, in reading order', () => {
    const t = fakeTerm(['abc', 'xabc', 'ab']);
    const m = searchBuffer(t, 'abc');
    expect(m).toEqual([
      { row: 0, col: 0, length: 3 },
      { row: 1, col: 1, length: 3 },
    ]);
  });

  it('trims trailing whitespace per line so end-of-line padding does not shift matches', () => {
    const t = fakeTerm(['error  ']); // translateToString(true) → 'error'
    const m = searchBuffer(t, 'error');
    expect(m).toEqual([{ row: 0, col: 0, length: 5 }]);
  });
});

describe('revealMatch', () => {
  it('selects the match and scrolls its row into view', () => {
    const t = fakeTerm(['one', 'two', 'three']);
    revealMatch(t, { row: 2, col: 0, length: 5 });
    expect(t._calls.select).toEqual([0, 2, 5]);
    expect(t._calls.scrollToLine).toBe(2);
  });
});
