import type { Terminal } from 'ghostty-web';

/**
 * Buffer-based in-terminal search.
 *
 * Replaces @xterm/addon-search, which ghostty-web (v0.4.0) does not ship.
 * Scans the active buffer's plain text (visible screen + scrollback) via
 * `term.buffer.active.getLine(y).translateToString()`. All coordinates are
 * absolute buffer rows (0 = top of scrollback), matching `term.select()`,
 * `term.scrollToLine()` and the `getLine(y)` index space.
 */
export interface SearchMatch {
  /** Absolute buffer row (0 = top of scrollback). */
  row: number;
  /** Start column (0-based) within the row. */
  col: number;
  /** Match length in cells (= query length for literal search). */
  length: number;
}

/**
 * Find every literal, case-insensitive occurrence of `query` across the whole
 * active buffer. Returns matches in reading order (top→bottom, left→right).
 *
 * Note: this walks the entire scrollback, so callers should debounce on input
 * (the component does ~150ms) to avoid recomputing on every keystroke.
 */
export function searchBuffer(term: Terminal, query: string): SearchMatch[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const matches: SearchMatch[] = [];
  const buffer = term.buffer.active;
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true).toLowerCase();
    let from = 0;
    let idx: number;
    while ((idx = text.indexOf(q, from)) !== -1) {
      matches.push({ row: y, col: idx, length: query.length });
      from = idx + q.length;
    }
  }
  return matches;
}

/**
 * Highlight a match (selection) and scroll it into view. Safe to call with a
 * match from {@link searchBuffer}.
 */
export function revealMatch(term: Terminal, match: SearchMatch): void {
  term.select(match.col, match.row, match.length);
  try {
    term.scrollToLine(match.row);
  } catch {
    // scrollToLine should not throw for in-range rows, but never let search
    // break the terminal over a scroll edge case.
  }
}
