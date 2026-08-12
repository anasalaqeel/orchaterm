import type { ILink, ILinkProvider } from 'ghostty-web';
import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * Minimal terminal surface needed to read a buffer line's text for URL
 * detection. Kept structural so this works against ghostty-web's Terminal
 * without importing its internal types.
 */
interface LineProviderTerminal {
  buffer: {
    active: {
      getLine(y: number): {
        length: number;
        getCell(x: number): { getCodepoint(): number } | undefined;
      } | undefined;
    };
  };
}

// Common URL schemes. Deliberately ASCII-only — URLs are ASCII, so reading the
// base codepoint per cell is sufficient (no grapheme shaping needed here).
const URL_REGEX =
  /(?:https?:\/\/|ftp:\/\/|ssh:\/\/|git:\/\/|gemini:\/\/|magnet:)[^\s"'<>]+|mailto:[^\s"'<>]+@[^\s"'<>]+/gi;

// Trailing punctuation that is almost certainly not part of the URL itself.
const TRAILING_PUNCT = /[.,;:!?)\]}"'@]+$/;

/**
 * Detects plain-text URLs in the terminal buffer and opens them via Tauri's
 * opener plugin (system default browser/handler) on click — preserving the
 * previous @xterm/addon-web-links behaviour.
 *
 * ghostty-web ships its own built-in URL detection; this provider is registered
 * in addition so activations route through `openUrl` rather than a generic
 * `window.open`. If both detect the same URL the link detector returns the
 * first registered match, so this is additive, not conflicting.
 */
export class UrlLinkProvider implements ILinkProvider {
  private terminal: LineProviderTerminal;

  constructor(terminal: LineProviderTerminal) {
    this.terminal = terminal;
  }

  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(y);
    if (!line) {
      callback(undefined);
      return;
    }

    // Reconstruct the row's text from per-cell codepoints.
    let text = '';
    for (let x = 0; x < line.length; x++) {
      const code = line.getCell(x)?.getCodepoint() ?? 0;
      text += code ? String.fromCodePoint(code) : ' ';
    }

    const links: ILink[] = [];
    URL_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_REGEX.exec(text)) !== null) {
      const url = match[0].replace(TRAILING_PUNCT, '');
      const start = match.index;
      const end = start + url.length - 1;
      if (end < start) continue;
      const capturedUrl = url;
      links.push({
        text: capturedUrl,
        range: { start: { x: start, y }, end: { x: end, y } },
        activate: () => {
          openUrl(capturedUrl).catch((err) =>
            console.error('[UrlLinkProvider] openUrl failed:', err),
          );
        },
      });
    }

    callback(links.length > 0 ? links : undefined);
  }
}
