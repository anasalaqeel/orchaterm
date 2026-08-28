import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { Copy, Check, ExternalLink } from 'lucide-react';

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

/**
 * Reusable Markdown Viewer with rich formatting:
 * - Code fences with language labels and Copy button
 * - Headings (H1-H4)
 * - Lists (ordered & unordered)
 * - Blockquotes
 * - Tables
 * - Inline formatting (bold, italic, code, strikethrough, links)
 */
export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content, className }) => {
  if (!content) return null;

  return <div className={cx(styles.container, className)}>{parseMarkdownBlocks(content)}</div>;
};

// ── Code Block with Copy Button ────────────────────────────────────────────────

interface CodeBlockProps {
  code: string;
  language?: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.codeBlockWrapper}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className={styles.copyCodeBtn}
          title="Copy code snippet"
          type="button"
        >
          {copied ? (
            <>
              <Check size={12} className={styles.copySuccessIcon} />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className={styles.codeContent}>
        <code>{code}</code>
      </pre>
    </div>
  );
};

// ── Inline Markdown Formatter ──────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  if (!text) return null;

  // Regex matches:
  // 1. `code`
  // 2. **bold** or __bold__
  // 3. *italic* or _italic_
  // 4. ~~strikethrough~~
  // 5. [link](url)
  const inlineRegex =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(inlineRegex);

  return parts.map((part, index) => {
    if (!part) return null;

    // Inline code: `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code key={index} className={styles.inlineCode}>
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bold: **bold** or __bold__
    if (
      (part.startsWith('**') && part.endsWith('**')) ||
      (part.startsWith('__') && part.endsWith('__'))
    ) {
      return (
        <strong key={index} className={styles.bold}>
          {renderInline(part.slice(2, -2))}
        </strong>
      );
    }

    // Italic: *italic* or _italic_
    if (
      (part.startsWith('*') && part.endsWith('*')) ||
      (part.startsWith('_') && part.endsWith('_'))
    ) {
      return (
        <em key={index} className={styles.italic}>
          {renderInline(part.slice(1, -1))}
        </em>
      );
    }

    // Strikethrough: ~~strike~~
    if (part.startsWith('~~') && part.endsWith('~~')) {
      return (
        <del key={index} className={styles.strikethrough}>
          {renderInline(part.slice(2, -2))}
        </del>
      );
    }

    // Link: [text](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, linkText, linkUrl] = linkMatch;
      return (
        <a
          key={index}
          href={linkUrl}
          target="_blank"
          rel="noreferrer noopener"
          className={styles.link}
        >
          {linkText}
          <ExternalLink size={10} className={styles.linkIcon} />
        </a>
      );
    }

    return part;
  });
}

// ── Block-level Markdown Parser ────────────────────────────────────────────────

function parseMarkdownBlocks(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Code block ```
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      nodes.push(<CodeBlock key={`code-${i}`} language={lang} code={codeLines.join('\n')} />);
      continue;
    }

    // 2. Headings (#, ##, ###, ####)
    if (line.startsWith('#### ')) {
      nodes.push(
        <h4 key={`h4-${i}`} className={styles.h4}>
          {renderInline(line.slice(5))}
        </h4>
      );
      i++;
      continue;
    }
    if (line.startsWith('### ')) {
      nodes.push(
        <h3 key={`h3-${i}`} className={styles.h3}>
          {renderInline(line.slice(4))}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={`h2-${i}`} className={styles.h2}>
          {renderInline(line.slice(3))}
        </h2>
      );
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      nodes.push(
        <h1 key={`h1-${i}`} className={styles.h1}>
          {renderInline(line.slice(2))}
        </h1>
      );
      i++;
      continue;
    }

    // 3. Horizontal Rule
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      nodes.push(<hr key={`hr-${i}`} className={styles.hr} />);
      i++;
      continue;
    }

    // 4. Blockquotes
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <blockquote key={`quote-${i}`} className={styles.blockquote}>
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx} className={styles.quoteParagraph}>
              {renderInline(ql)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    // 5. Unordered List (- or *)
    if (/^\s*[\*\-]\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*[\*\-]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*[\*\-]\s+/, ''));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className={styles.ul}>
          {listItems.map((item, idx) => (
            <li key={idx} className={styles.li}>
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 6. Ordered List (1. 2. etc)
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      nodes.push(
        <ol key={`ol-${i}`} className={styles.ol}>
          {listItems.map((item, idx) => (
            <li key={idx} className={styles.li}>
              {renderInline(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // 7. Table (| Header | Header |)
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const headerCells = tableLines[0]
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());

        // Check if second line is separator like |---|---|
        const isSeparator = /^\|?(\s*:?-+:?\s*\|?)+$/.test(tableLines[1]);
        const dataRows = isSeparator ? tableLines.slice(2) : tableLines.slice(1);

        nodes.push(
          <div key={`table-wrapper-${i}`} className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {headerCells.map((h, hIdx) => (
                    <th key={hIdx} className={styles.th}>
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((rowStr, rIdx) => {
                  const cells = rowStr
                    .slice(1, -1)
                    .split('|')
                    .map((c) => c.trim());
                  return (
                    <tr key={rIdx} className={styles.tr}>
                      {cells.map((cell, cIdx) => (
                        <td key={cIdx} className={styles.td}>
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // 8. Empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 9. Standard Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('> ') &&
      !/^\s*[\*\-]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^(\-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !(lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|'))
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    nodes.push(
      <p key={`p-${i}`} className={styles.paragraph}>
        {renderInline(paraLines.join(' '))}
      </p>
    );
  }

  return nodes;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  container: css`
    font-size: var(--font-size-sm, 13px);
    line-height: 1.6;
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    gap: 8px;
    word-break: break-word;
  `,
  paragraph: css`
    margin: 0;
    line-height: 1.6;
  `,
  bold: css`
    font-weight: 700;
    color: var(--text-primary);
  `,
  italic: css`
    font-style: italic;
  `,
  strikethrough: css`
    text-decoration: line-through;
    color: var(--text-tertiary);
  `,
  inlineCode: css`
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 1px 6px;
    font-family: var(--font-family-mono, monospace);
    font-size: 0.88em;
    color: var(--color-info);
  `,
  link: css`
    color: var(--color-brand);
    text-decoration: underline;
    text-underline-offset: 2px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    transition: color 0.15s ease;

    &:hover {
      filter: brightness(1.2);
    }
  `,
  linkIcon: css`
    display: inline;
    vertical-align: middle;
  `,
  h1: css`
    font-size: 1.4em;
    font-weight: 700;
    color: var(--text-primary);
    margin: 12px 0 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-color);
  `,
  h2: css`
    font-size: 1.25em;
    font-weight: 700;
    color: var(--text-primary);
    margin: 10px 0 4px;
    padding-bottom: 2px;
    border-bottom: 1px solid var(--border-color);
  `,
  h3: css`
    font-size: 1.1em;
    font-weight: 600;
    color: var(--text-primary);
    margin: 8px 0 2px;
  `,
  h4: css`
    font-size: 1em;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 6px 0 2px;
  `,
  hr: css`
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 10px 0;
  `,
  blockquote: css`
    margin: 6px 0;
    padding: 6px 10px;
    background-color: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    border-top: 1px dashed var(--border-color);
    border-bottom: 1px dashed var(--border-color);
    font-family: var(--font-family-mono);
    color: var(--text-secondary);
  `,
  quoteParagraph: css`
    margin: 0;
    font-style: italic;
  `,
  ul: css`
    margin: 4px 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  ol: css`
    margin: 4px 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  li: css`
    line-height: 1.5;
  `,
  codeBlockWrapper: css`
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background-color: var(--bg-canvas);
    margin: 8px 0;
    overflow: hidden;
  `,
  codeHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 10px;
    background-color: rgba(var(--material-brass-rgb), 0.06);
    border-bottom: 1px solid var(--border-color);
  `,
  codeLang: css`
    font-size: 10px;
    font-family: var(--font-family-mono, monospace);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  `,
  copyCodeBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: rgba(var(--material-brass-rgb), 0.14);
      color: var(--text-primary);
    }
  `,
  copySuccessIcon: css`
    color: var(--color-success);
  `,
  codeContent: css`
    margin: 0;
    padding: 10px 12px;
    font-family: var(--font-family-mono, monospace);
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-primary);
    overflow-x: auto;
    white-space: pre;

    code {
      font-family: inherit;
    }
  `,
  tableWrapper: css`
    overflow-x: auto;
    margin: 8px 0;
    border-radius: 6px;
    border: 1px solid var(--border-color);
  `,
  table: css`
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  `,
  th: css`
    background-color: var(--bg-tertiary, rgba(255, 255, 255, 0.05));
    color: var(--text-primary);
    font-weight: 600;
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-color);
  `,
  tr: css`
    &:nth-child(even) {
      background-color: rgba(var(--material-brass-rgb), 0.03);
    }
    &:hover {
      background-color: rgba(var(--material-brass-rgb), 0.06);
    }
  `,
  td: css`
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-secondary);
  `,
};
