import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { HelpModal } from '../components/ui/HelpModal';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function sectionButton(title: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === title
  );
  expect(btn, `section button "${title}" should render`).toBeTruthy();
  return btn!;
}

/** Renders the open modal and returns the accumulated markup of every section. */
async function renderAllSections(): Promise<string> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<HelpModal isOpen onClose={() => {}} />);
  });
  let html = container.innerHTML;
  for (const title of [
    'Keyboard Shortcuts',
    'Quick Actions',
    'Prompt Vault & Templates',
    'Terminal & Workspaces',
    'Conductor Multi-Agent',
    'Settings & AI Configuration',
  ]) {
    await act(async () => {
      sectionButton(title).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });
    html += container.innerHTML;
  }
  return html;
}

describe('HelpModal', () => {
  afterEach(async () => {
    if (root)
      await act(async () => {
        root!.unmount();
      });
    container.remove();
    root = null;
  });

  it('renders nothing when closed', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<HelpModal isOpen={false} onClose={() => {}} />);
    });
    expect(container.innerHTML).toBe('');
  });

  it('renders all guide sections', async () => {
    const html = await renderAllSections();
    // innerHTML escapes entities, so titles with "&" appear as "&amp;".
    for (const title of [
      'Keyboard Shortcuts',
      'Quick Actions',
      'Prompt Vault &amp; Templates',
      'Terminal &amp; Workspaces',
      'Conductor Multi-Agent',
      'Settings &amp; AI Configuration',
    ]) {
      expect(html).toContain(title);
    }
  });

  it('documents quick actions as inject-only', async () => {
    const html = await renderAllSections();
    expect(html).toContain('1 click, no dialogs');
    expect(html).toContain('{{terminal_output}}');
    expect(html).toContain('Inject command or prompt text into the active terminal');
    expect(html).toContain('Close modal or search overlay');
  });

  it('contains no leftover copy from the removed AI-modal workflow', async () => {
    const html = await renderAllSections();
    for (const stale of [
      'AI Prompt Drawer',
      'Run Prompt',
      'Inject to Terminal',
      'Send to AI Chat',
      'Save to Vault',
      'Markdown Modal Dialog',
    ]) {
      expect(html).not.toContain(stale);
    }
  });
});
