/**
 * Settings → Terminal tab → Quick Actions editor: adding an action produces a
 * plain inject action (no modal-era type/target fields), the Prompt Vault
 * quick-fill carries the prompt content + promptVaultId as a paste action,
 * deleting removes the row, and "Save Terminal Settings" persists the list
 * through updateSettings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { invoke } from '@tauri-apps/api/core';
import type { SavedPrompt, QuickAction } from '../types';

const mockedInvoke = vi.mocked(invoke);

const { mockDashboard, updateSettings } = vi.hoisted(() => ({
  mockDashboard: {
    workspaces: [],
    theme: 'dark',
    toggleTheme: vi.fn(),
    exportSettings: vi.fn(),
    importSettings: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    showToast: vi.fn(),
    savedPrompts: [] as SavedPrompt[],
    settings: {
      llmProviders: {},
      llmProviderMode: 'advanced',
      providerApiKeys: {},
      conductorTaskTimeoutMinutes: 30,
      conductorInteractionMode: 'auto',
      shellPath: '',
      quickActions: [] as QuickAction[],
    },
  },
  updateSettings: vi.fn(),
}));

vi.mock('../context/DashboardContext', () => ({
  useDashboard: () => ({ ...mockDashboard, updateSettings }),
}));

import { SettingsView } from '../pages/Settings';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SAVED_PROMPT: SavedPrompt = {
  id: 'p1',
  workspaceId: '',
  spaceId: null,
  title: 'Explain Error',
  content: 'Explain this error:\n```\n{{terminal_output}}\n```',
  tags: ['debug'],
  createdAt: '2026-08-18T00:00:00Z',
  usedAt: null,
};

let container: HTMLDivElement;
let root: Root | null = null;

async function renderSettings() {
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_available_shells') {
      return [{ name: 'PowerShell', path: 'C:\\pwsh.exe', args: [] }];
    }
    return undefined;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={['/settings#terminal']}>
        <SettingsView />
      </MemoryRouter>,
    );
  });
  // The #terminal effect scrolls to the section after 100ms.
  await act(async () => { await new Promise(r => setTimeout(r, 130)); });
}

function setValueByPlaceholder(placeholderSubstring: string, value: string) {
  const el = container.querySelector(`[placeholder*="${placeholderSubstring}"]`) as HTMLInputElement;
  expect(el, `input with placeholder containing "${placeholderSubstring}"`).toBeTruthy();
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickByText(text: string, scope: ParentNode = container, selector = 'button') {
  const el = Array.from(scope.querySelectorAll(selector))
    .find(n => n.textContent?.trim() === text || n.getAttribute('title') === text);
  expect(el, `element "${text}" should be rendered`).toBeTruthy();
  el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function savedQuickActions(): QuickAction[] {
  // updateSettings takes a single patch object; mock.calls entries are [patch].
  const call = updateSettings.mock.calls.find(args => args[0] && 'quickActions' in (args[0] as object));
  expect(call, 'updateSettings should have been called with quickActions').toBeTruthy();
  return ((call![0] as { quickActions: QuickAction[] }).quickActions);
}

describe('Settings quick actions editor', () => {
  beforeEach(() => {
    updateSettings.mockClear();
    mockDashboard.savedPrompts = [{ ...SAVED_PROMPT }];
    mockDashboard.settings = { ...mockDashboard.settings, quickActions: [] };
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    container.remove();
    root = null;
  });

  it('adds a quick action as a plain inject action and persists it', async () => {
    await renderSettings();

    setValueByPlaceholder('e.g. Status', 'Build');
    setValueByPlaceholder('e.g. git status', 'npm run build');
    await act(async () => { clickByText('+ Add Quick Action'); });
    expect(container.textContent).toContain('Build'); // appears in the table

    await act(async () => { clickByText('Save Terminal Settings'); });
    const actions = savedQuickActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].label).toBe('Build');
    expect(actions[0].command).toBe('npm run build');
    expect(actions[0].autoExecute).toBe(false);
    // The modal-era routing fields must not be reintroduced by the editor.
    expect(Object.keys(actions[0])).not.toContain('type');
    expect(Object.keys(actions[0])).not.toContain('target');
  });

  it('quick-fills from the Prompt Vault as a paste action carrying promptVaultId', async () => {
    await renderSettings();

    // Open the custom Select (portal dropdown) and pick the saved prompt.
    // Options select on mousedown and their text includes the description.
    await act(async () => { clickByText('Choose a prompt to copy...'); });
    const option = Array.from(document.body.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Explain Error'));
    expect(option, 'vault prompt option should be rendered in the dropdown').toBeTruthy();
    await act(async () => {
      option!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });

    // The form should now hold the prompt's title + content.
    expect((container.querySelector('[placeholder*="e.g. Status"]') as HTMLInputElement).value)
      .toBe('Explain Error');

    await act(async () => { clickByText('+ Add Quick Action'); });
    await act(async () => { clickByText('Save Terminal Settings'); });

    const actions = savedQuickActions();
    expect(actions).toHaveLength(1);
    const action = actions[0];
    expect(action.promptVaultId).toBe('p1');
    expect(action.command).toBe(SAVED_PROMPT.content);
    expect(action.autoExecute).toBe(false);
    expect(Object.keys(action)).not.toContain('type');
    expect(Object.keys(action)).not.toContain('target');
  });

  it('deletes a quick action from the table', async () => {
    mockDashboard.settings = {
      ...mockDashboard.settings,
      quickActions: [{ id: 'qa-1', label: 'Status', command: 'git status', autoExecute: true }],
    };
    await renderSettings();
    expect(container.textContent).toContain('git status');

    await act(async () => { clickByText('Delete action'); });
    expect(container.textContent).not.toContain('git status');

    await act(async () => { clickByText('Save Terminal Settings'); });
    expect(savedQuickActions()).toHaveLength(0);
  });
});
