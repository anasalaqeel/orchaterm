/**
 * Prompt Vault "Pin to Quick Actions" behavior: pinning creates a plain
 * paste action (no modal-era type/target fields, never auto-executing) that
 * carries the vault prompt's content and promptVaultId; the pinned state is
 * reflected on the card; unpinning removes the action.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import type { SavedPrompt, QuickAction } from '../types';

const { mockDashboard, updateSettings } = vi.hoisted(() => ({
  mockDashboard: {
    savedPrompts: [] as SavedPrompt[],
    workspaces: [],
    settings: { quickActions: [] as QuickAction[] },
  },
  updateSettings: vi.fn(),
}));

vi.mock('../context/DashboardContext', () => ({
  useDashboard: () => ({
    ...mockDashboard,
    updateSettings,
    addSavedPrompt: vi.fn(),
    updateSavedPrompt: vi.fn(),
    deleteSavedPrompt: vi.fn(),
    copyPromptToClipboard: vi.fn(),
    showToast: vi.fn(),
  }),
}));

import { PromptVaultView } from '../pages/PromptVault';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PROMPT: SavedPrompt = {
  id: 'p1',
  workspaceId: '',
  spaceId: null,
  title: 'Explain build failure',
  content: 'Explain this error:\n```\n{{terminal_output}}\n```',
  tags: ['debug'],
  createdAt: '2026-08-17T00:00:00Z',
  usedAt: null,
};

let container: HTMLDivElement;
let root: Root | null = null;

async function renderVault() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<PromptVaultView />);
  });
}

function pinButton(): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button'))
    .find(b => b.textContent?.includes('Pin to Actions') || b.textContent?.includes('Pinned'));
  expect(btn, 'pin button should be rendered').toBeTruthy();
  return btn!;
}

describe('Prompt Vault → Quick Actions pinning', () => {
  beforeEach(() => {
    updateSettings.mockClear();
    mockDashboard.savedPrompts = [{ ...PROMPT }];
    mockDashboard.settings = { quickActions: [] };
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    container.remove();
    root = null;
  });

  it('pins a prompt as a plain paste action with no modal-era fields', async () => {
    await renderVault();
    await act(async () => { pinButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });

    expect(updateSettings).toHaveBeenCalledTimes(1);
    const [settingsArg] = updateSettings.mock.calls[0] as [{ quickActions: QuickAction[] }];
    const action = settingsArg.quickActions.find(a => a.promptVaultId === 'p1');
    expect(action).toBeDefined();
    // The old AI-modal routing fields must NOT come back.
    expect(Object.keys(action!)).not.toContain('type');
    expect(Object.keys(action!)).not.toContain('target');
    expect(action!.autoExecute).toBe(false); // paste, never auto-run
    expect(action!.command).toBe(PROMPT.content);
    expect(action!.id).toBe('qa-prompt-p1');
  });

  it('reflects the pinned state and unpins on second click', async () => {
    mockDashboard.settings = {
      quickActions: [{
        id: 'qa-prompt-p1',
        label: 'Explain build failure',
        iconName: 'Sparkles',
        command: PROMPT.content,
        autoExecute: false,
        color: '#a855f7',
        promptVaultId: 'p1',
      }],
    };
    await renderVault();
    expect(pinButton().textContent).toContain('Pinned');

    await act(async () => { pinButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    const [settingsArg] = updateSettings.mock.calls[0] as [{ quickActions: QuickAction[] }];
    expect(settingsArg.quickActions).toHaveLength(0); // action removed
  });
});
