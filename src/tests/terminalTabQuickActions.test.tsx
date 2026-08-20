/**
 * Integration test for the Quick Actions injection path through the real
 * TerminalTab component: click a bar button → gather terminal context →
 * interpolate {{variables}} → bracketed-paste wrap → write_pty invoke.
 *
 * Module boundaries are mocked (xterm, Tauri invoke/listen, DashboardContext);
 * everything between them — QuickActionsBar rendering, handleRunAction,
 * buildPromptContext, interpolatePromptTemplate, formatTerminalWrite,
 * writePtyChunked — runs as real production code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { invoke } from '@tauri-apps/api/core';

const mockedInvoke = vi.mocked(invoke);

// ── Mocked dashboard state (hoisted so the vi.mock factory can close over it)
const { mockDashboard } = vi.hoisted(() => ({
  mockDashboard: {
    settings: {
      quickActions: [] as Array<{
        id: string;
        label: string;
        command: string;
        autoExecute: boolean;
      }>,
    },
    workspaces: [{ id: 'w1', name: 'Orchaterm', path: 'C:\\dev\\orchaterm' }],
    spaces: [],
    activeWorkspaceId: 'w1',
    activeSpaceId: null,
  },
}));

vi.mock('../context/DashboardContext', () => ({
  useDashboard: () => mockDashboard,
}));

// ── Fake xterm Terminal shared with the other TerminalTab test file ──────────
vi.mock('@xterm/xterm', async () => {
  const { FakeTerminal } = await import('./helpers/fakeTerminal');
  return { Terminal: FakeTerminal };
});
const { getLastTerminal } = await import('./helpers/fakeTerminal');
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    proposeDimensions() {
      return { cols: 80, rows: 24 };
    }
    fit() {}
  },
}));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    clearDecorations() {}
  },
}));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss(_cb: unknown) {}
    dispose() {}
    clearTextureAtlas() {}
  },
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

import { TerminalTab } from '../components/terminal/TerminalTab';
import { DEFAULT_QUICK_ACTIONS } from '../utils/terminalThemes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function writtenPayloads(): string[] {
  return mockedInvoke.mock.calls
    .filter(([cmd]) => cmd === 'write_pty')
    .map(([, args]) => (args as { data: string }).data);
}

async function renderTerminalTab() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter>
        <TerminalTab sessionId="s-test" workspacePath={'C:\\dev\\orchaterm'} shell="pwsh.exe" />
      </MemoryRouter>
    );
  });
  // Let the mount effect settle (spawn polling runs on rAF timers).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

async function clickActionButton(label: string) {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(label)
  );
  expect(btn, `quick action button "${label}" should be rendered`).toBeTruthy();
  await act(async () => {
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('TerminalTab quick action injection (integration)', () => {
  beforeEach(() => {
    mockedInvoke.mockClear();
  });

  afterEach(async () => {
    if (root)
      await act(async () => {
        root!.unmount();
      });
    container.remove();
    root = null;
  });

  it('auto-run action writes the command wrapped in bracketed paste with Enter', async () => {
    mockDashboard.settings.quickActions = [
      { id: 'a1', label: 'Status', command: 'git status', autoExecute: true },
    ];
    await renderTerminalTab();
    await clickActionButton('Status');
    expect(writtenPayloads()).toEqual(['\x1b[200~git status\x1b[201~\r']);
  });

  it('prompt action expands {{terminal_output}} from the live buffer and pastes without Enter', async () => {
    mockDashboard.settings.quickActions = [
      { id: 'a2', label: 'Explain', command: 'Fix this:\n{{terminal_output}}', autoExecute: false },
    ];
    await renderTerminalTab();
    getLastTerminal().lines = ['$ npm run buld', 'npm ERR! missing script: buld'];
    await clickActionButton('Explain');
    expect(writtenPayloads()).toEqual([
      '\x1b[200~Fix this:\n$ npm run buld\nnpm ERR! missing script: buld\x1b[201~',
    ]);
  });

  it('expands {{selection}} from the highlighted terminal text', async () => {
    mockDashboard.settings.quickActions = [
      { id: 'a3', label: 'Review', command: 'Review: {{selection}}', autoExecute: false },
    ];
    await renderTerminalTab();
    getLastTerminal().selectionText = 'const x = 1;';
    await clickActionButton('Review');
    expect(writtenPayloads()).toEqual(['\x1b[200~Review: const x = 1;\x1b[201~']);
  });

  it('resolves {{workspace_path}} from the active workspace', async () => {
    mockDashboard.settings.quickActions = [
      { id: 'a4', label: 'Cd', command: 'cd {{workspace_path}}', autoExecute: true },
    ];
    await renderTerminalTab();
    await clickActionButton('Cd');
    expect(writtenPayloads()).toEqual(['\x1b[200~cd C:\\dev\\orchaterm\x1b[201~\r']);
  });

  it('sends raw text plus Enter when bracketed paste mode is off', async () => {
    mockDashboard.settings.quickActions = [
      { id: 'a5', label: 'Status', command: 'git status', autoExecute: true },
    ];
    await renderTerminalTab();
    getLastTerminal().modes.bracketedPasteMode = false;
    await clickActionButton('Status');
    expect(writtenPayloads()).toEqual(['git status\r']);
  });

  it('falls back to DEFAULT_QUICK_ACTIONS and pastes the shipped Explain Error template unexecuted', async () => {
    mockDashboard.settings.quickActions = []; // empty → bar falls back to defaults
    await renderTerminalTab();
    const bufferText = '$ npm run buld\nnpm ERR! missing script: buld';
    getLastTerminal().lines = bufferText.split('\n');
    await clickActionButton('Explain Error');
    // The expanded default template exceeds one 80-char chunk — wait for the
    // inter-chunk delays (8ms each) before asserting.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const chunks = writtenPayloads();
    expect(chunks.length).toBeGreaterThanOrEqual(2); // really went through chunking
    const defaultAction = DEFAULT_QUICK_ACTIONS.find((a) => a.id === 'ai-explain')!;
    const expected = `\x1b[200~${defaultAction.command.replace('{{terminal_output}}', bufferText)}\x1b[201~`;
    expect(chunks.join('')).toBe(expected); // pasted, NOT executed: no trailing \r
  });
});
