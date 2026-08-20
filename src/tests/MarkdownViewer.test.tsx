import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownViewer } from '../components/ui/MarkdownViewer';

describe('MarkdownViewer', () => {
  it('renders null when content is empty', () => {
    const html = renderToStaticMarkup(<MarkdownViewer content="" />);
    expect(html).toBe('');
  });

  it('renders headings and bold text', () => {
    const md = '# Title 1\n## Section 2\n**Bold Statement**';
    const html = renderToStaticMarkup(<MarkdownViewer content={md} />);
    expect(html).toContain('Title 1');
    expect(html).toContain('Section 2');
    expect(html).toContain('Bold Statement');
    expect(html).toContain('<strong');
  });

  it('renders code blocks with copy buttons and language labels', () => {
    const md = '```typescript\nconst greeting = "hello world";\n```';
    const html = renderToStaticMarkup(<MarkdownViewer content={md} />);
    expect(html).toContain('typescript');
    expect(html).toContain('const greeting = &quot;hello world&quot;;');
    expect(html).toContain('Copy');
  });

  it('renders bullet lists and ordered lists', () => {
    const md = '- Item 1\n- Item 2\n\n1. Step A\n2. Step B';
    const html = renderToStaticMarkup(<MarkdownViewer content={md} />);
    expect(html).toContain('Item 1');
    expect(html).toContain('Item 2');
    expect(html).toContain('Step A');
    expect(html).toContain('Step B');
    expect(html).toContain('<ul');
    expect(html).toContain('<ol');
  });

  it('renders tables correctly', () => {
    const md = '| Key | Value |\n| --- | --- |\n| Status | Active |';
    const html = renderToStaticMarkup(<MarkdownViewer content={md} />);
    expect(html).toContain('<table');
    expect(html).toContain('Key');
    expect(html).toContain('Value');
    expect(html).toContain('Status');
    expect(html).toContain('Active');
  });
});
