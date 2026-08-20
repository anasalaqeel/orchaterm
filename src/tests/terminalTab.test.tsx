/**
 * TerminalTab lifecycle & interaction tests: PTY spawn (args + ordering),
 * spawn failure/retry, PTY output flow (leading-newline strip), process exit,
 * input forwarding (direct vs chunked), resize forwarding with dimension
 * guard, keyboard handler (search, keybindings, kitty protocol), floating
 * copy button, context menu, and unmount cleanup.
 *
 * Mocks sit at module boundaries only (xterm suite, Tauri invoke/listen,
 * DashboardContext); everything else is production code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { TerminalConfig } from '../types';

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

// ── Mocked dashboard state ────────────────────────────────────────────────────
const { mockDashboard } = vi.hoisted(() => ({
  mockDashboard: {
    settings: {} as { quickActions?: unknown[]; terminalConfig?: TerminalConfig },
    workspaces: [{ id: 'w1', name: 'Orchaterm', path: 'C:\\dev\\orchaterm' }],
    spaces: [],
    activeWorkspaceId: 'w1',
    activeSpaceId: null,
  },
}));

vi.mock('../context/DashboardContext', () => ({
  useDashboard: () => mockDashboard,
}));

vi.mock('@xterm/xterm', async () => {
  const { FakeTerminal } = await import('./helpers/fakeTerminal');
  return { Terminal: FakeTerminal };
});
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
    queries: string[] = [];
    cleared = 0;
    findNext(q: string) {
      this.queries.push(q);
    }
    findPrevious(q: string) {
      this.queries.push(q);
    }
    clearDecorations() {
      this.cleared++;
    }
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
import { DEFAULT_TERMINAL_CONFIG } from '../utils/terminalThemes';
import { getLastTerminal } from './helpers/fakeTerminal';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no async clipboard; stub the API the copy paths call.
const clipboardStub = {
  writeText: vi.fn().mockResolvedValue(undefined),
  readText: vi.fn().mockResolvedValue(''),
};
Object.defineProperty(navigator, 'clipboard', {
  value: clipboardStub,
  configurable: true,
});

let container: HTMLDivElement;
let root: Root | null = null;
const onExit = vi.fn();
/** PTY event listeners captured from the mocked Tauri `listen`. */
let ptyListeners: Record<string, (event: unknown) => void> = {};

function commandsCalled(cmd: string): Record<string, unknown>[] {
  return mockedInvoke.mock.calls
    .filter(([c]) => c === cmd)
    .map(([, args]) => (args ?? {}) as Record<string, unknown>);
}

function writtenPayloads(): string[] {
  return commandsCalled('write_pty').map((a) => (a as { data: string }).data);
}

function resetDashboard() {
  mockDashboard.settings = {
    quickActions: [],
    terminalConfig: {
      ...DEFAULT_TERMINAL_CONFIG,
      keybindings: [...DEFAULT_TERMINAL_CONFIG.keybindings],
    },
  };
}

async function renderTerminalTab() {
  ptyListeners = {};
  mockedListen.mockImplementation(async (name: any, cb: any) => {
    ptyListeners[name] = cb;
    return () => {};
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter>
        <TerminalTab
          sessionId="s1"
          workspacePath={'C:\\dev\\orchaterm'}
          shell="pwsh.exe"
          onExit={onExit}
        />
      </MemoryRouter>
    );
  });
  // Let the mount effect settle (spawn polling runs on rAF timers).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

function firePtyData(data: string) {
  ptyListeners[`pty-data-s1`]({ payload: { session_id: 's1', data } });
}

function clickElementByText(text: string, selector = 'button, div') {
  const el = Array.from(container.querySelectorAll(selector)).find(
    (n) => n.textContent?.trim() === text
  );
  expect(el, `element "${text}" should be rendered`).toBeTruthy();
  el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('TerminalTab PTY lifecycle', () => {
  beforeEach(() => {
    mockedInvoke.mockReset().mockResolvedValue(undefined);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'spawn_pty') return undefined;
      if (cmd === 'windows_build_number') return null;
      return undefined;
    });
    mockedListen.mockReset();
    onExit.mockClear();
    clipboardStub.writeText.mockClear();
    resetDashboard();
  });

  afterEach(async () => {
    if (root)
      await act(async () => {
        root!.unmount();
      });
    container.remove();
    root = null;
  });

  it('spawns the PTY with fitted dims and shell args, after the data listener attaches', async () => {
    await renderTerminalTab();
    expect(commandsCalled('spawn_pty')).toEqual([
      {
        sessionId: 's1',
        workspacePath: 'C:\\dev\\orchaterm',
        cols: 80,
        rows: 24,
        shell: 'pwsh.exe',
        shellArgs: [],
      },
    ]);
    expect(Object.keys(ptyListeners)).toEqual(
      expect.arrayContaining(['pty-data-s1', 'pty-exit-s1'])
    );
    // Listener registration must precede spawn, else initial output is dropped.
    const listenOrder = mockedListen.mock.invocationCallOrder[0];
    const spawnCall = mockedInvoke.mock.calls.findIndex(([c]) => c === 'spawn_pty');
    const spawnOrder = mockedInvoke.mock.invocationCallOrder[spawnCall];
    expect(listenOrder).toBeLessThan(spawnOrder);
  });

  it('shows the error overlay when spawn fails and Retry respawns', async () => {
    let attempts = 0;
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'spawn_pty' && ++attempts === 1) throw 'shell not found';
      return cmd === 'windows_build_number' ? null : undefined;
    });
    await renderTerminalTab();

    expect(container.textContent).toContain('Terminal failed to start');
    expect(container.textContent).toContain('shell not found');
    expect(getLastTerminal().writes.join('')).toContain(
      '[Error] Failed to spawn shell: shell not found'
    );

    await act(async () => {
      clickElementByText('Retry', 'button');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(commandsCalled('spawn_pty')).toHaveLength(2);
    expect(container.textContent).not.toContain('Terminal failed to start');
  });

  it('writes PTY output to the terminal, stripping exactly one leading prompt newline', async () => {
    await renderTerminalTab();
    const term = getLastTerminal();

    await act(async () => {
      firePtyData('\x1b[2J\x1b[H');
    }); // escapes only → keep waiting
    expect(term.writes).toEqual(['\x1b[2J\x1b[H']);

    await act(async () => {
      firePtyData('\r\n$ ');
    }); // Git-Bash-style leading newline → strip
    expect(term.writes[term.writes.length - 1]).toBe('$ ');

    await act(async () => {
      firePtyData('\nmore output');
    }); // one-shot: later newlines kept
    expect(term.writes[term.writes.length - 1]).toBe('\nmore output');
  });

  it('marks the process exited and reports onExit', async () => {
    await renderTerminalTab();
    await act(async () => {
      ptyListeners['pty-exit-s1'](undefined);
    });
    expect(getLastTerminal().writes.join('')).toContain('[Process Exited]');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('forwards small keystrokes directly and chunks large pastes', async () => {
    await renderTerminalTab();
    await act(async () => {
      getLastTerminal().fireData('x');
    });
    expect(writtenPayloads()).toEqual(['x']);

    mockedInvoke.mockClear();
    const big = 'a'.repeat(200);
    await act(async () => {
      getLastTerminal().fireData(big);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const chunks = writtenPayloads();
    expect(chunks.length).toBeGreaterThanOrEqual(3); // went through chunking
    expect(chunks.join('')).toBe(big);
  });

  it('forwards grid changes to resize_pty only when dimensions actually change', async () => {
    await renderTerminalTab(); // spawns at 80x24
    await act(async () => {
      getLastTerminal().fireResize(120, 40);
    });
    expect(commandsCalled('resize_pty')).toEqual([{ sessionId: 's1', cols: 120, rows: 40 }]);

    await act(async () => {
      getLastTerminal().fireResize(120, 40);
    }); // same size → suppressed
    expect(commandsCalled('resize_pty')).toHaveLength(1);
  });

  it('kills the PTY and disposes the terminal on unmount', async () => {
    await renderTerminalTab();
    const term = getLastTerminal();
    await act(async () => {
      root!.unmount();
    });
    root = null;
    expect(commandsCalled('kill_pty')).toEqual([{ sessionId: 's1' }]);
    expect(term.disposed).toBe(true);
  });
});

describe('TerminalTab keyboard handling', () => {
  beforeEach(() => {
    mockedInvoke.mockReset().mockResolvedValue(undefined);
    mockedListen.mockReset();
    onExit.mockClear();
    resetDashboard();
  });

  afterEach(async () => {
    if (root)
      await act(async () => {
        root!.unmount();
      });
    container.remove();
    root = null;
  });

  it('opens search on Ctrl+F and closes on Escape', async () => {
    await renderTerminalTab();
    const term = getLastTerminal();

    expect(await act(async () => term.fireKey({ ctrlKey: true, key: 'f' }))).toBe(false);
    expect(container.querySelector('[data-search-input="true"]')).toBeTruthy();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    }); // rAF focus pass
    expect(await act(async () => term.fireKey({ key: 'Escape' }))).toBe(false);
    expect(container.querySelector('[data-search-input="true"]')).toBeNull();
  });

  it('executes a configured send-text keybinding', async () => {
    mockDashboard.settings.terminalConfig = {
      ...DEFAULT_TERMINAL_CONFIG,
      keybindings: [
        ...DEFAULT_TERMINAL_CONFIG.keybindings,
        { key: 'ctrl+g', action: 'send-text', text: 'git status\r' },
      ],
    };
    await renderTerminalTab();

    expect(await act(async () => getLastTerminal().fireKey({ ctrlKey: true, key: 'g' }))).toBe(
      false
    );
    expect(writtenPayloads()).toContain('git status\r');
  });

  it('copy binding writes the current selection to the clipboard', async () => {
    await renderTerminalTab();
    const term = getLastTerminal();
    term.selectionText = 'selected text';

    // ctrl+shift+c is a default keybinding
    expect(await act(async () => term.fireKey({ ctrlKey: true, shiftKey: true, key: 'c' }))).toBe(
      false
    );
    expect(clipboardStub.writeText).toHaveBeenCalledWith('selected text');
  });

  it('kitty protocol: answers flag queries and CSI-u encodes ambiguous keys once enabled', async () => {
    await renderTerminalTab();
    const term = getLastTerminal();

    // App asks for active flags → reply CSI ? 0 u before any push.
    await act(async () => {
      term.fireCsi('?', 'u', []);
    });
    expect(writtenPayloads()).toContain('\x1b[?0u');

    // Without the disambiguate flag, Enter stays legacy (passthrough).
    expect(await act(async () => term.fireKey({ key: 'Enter' }))).toBe(true);

    // App pushes flags=1 (disambiguate escape codes).
    await act(async () => {
      term.fireCsi('=', 'u', [1, 1]);
    });

    // Shift+Enter and bare Escape must now be CSI-u encoded, not legacy bytes.
    expect(await act(async () => term.fireKey({ shiftKey: true, key: 'Enter' }))).toBe(false);
    expect(writtenPayloads()).toContain('\x1b[13;2u');
    expect(await act(async () => term.fireKey({ key: 'Escape' }))).toBe(false);
    expect(writtenPayloads()).toContain('\x1b[27;1u');
  });
});

describe('TerminalTab UI surfaces', () => {
  beforeEach(() => {
    mockedInvoke.mockReset().mockResolvedValue(undefined);
    mockedListen.mockReset();
    onExit.mockClear();
    clipboardStub.writeText.mockClear();
    resetDashboard();
  });

  afterEach(async () => {
    if (root)
      await act(async () => {
        root!.unmount();
      });
    container.remove();
    root = null;
  });

  it('shows the floating copy button when a selection exists and copies it', async () => {
    await renderTerminalTab();
    const term = getLastTerminal();
    term.selectionText = 'copy me';

    await act(async () => {
      term.fireSelectionChange();
    });
    clickElementByText('Copy', 'button');
    await act(async () => {});
    expect(clipboardStub.writeText).toHaveBeenCalledWith('copy me');
    expect(container.textContent).toContain('Copied');
  });

  it('Escape closes the context menu (key handler reads live state)', async () => {
    await renderTerminalTab();
    const term = getLastTerminal();
    await act(async () => {
      term.element!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      );
    });
    expect(container.textContent).toContain('Select All');

    // Regression: the once-attached key handler used to capture the mount-time
    // contextMenu (null), so Escape passed through to the PTY instead.
    expect(await act(async () => term.fireKey({ key: 'Escape' }))).toBe(false);
    expect(container.textContent).not.toContain('Select All');
  });

  it('context menu offers Select All and Clear', async () => {
    await renderTerminalTab();
    const term = getLastTerminal();
    expect(term.element).toBeTruthy();

    await act(async () => {
      term.element!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      );
    });
    expect(container.textContent).toContain('Select All');

    await act(async () => {
      clickElementByText('Select All', 'div');
    });
    expect(term.selectAllCalled).toBe(true);
    expect(container.textContent).not.toContain('Select All'); // menu closed

    await act(async () => {
      term.element!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      );
    });
    await act(async () => {
      clickElementByText('Clear', 'div');
    });
    expect(term.cleared).toBe(1);
  });

  it('search input drives the search addon and shows the result count', async () => {
    await renderTerminalTab();
    const term = getLastTerminal();
    await act(async () => {
      term.fireKey({ ctrlKey: true, key: 'f' });
    });

    const input = container.querySelector('[data-search-input="true"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set;
    await act(async () => {
      setter!.call(input, 'error');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const addon = term.loadedAddons.find((a) => 'findNext' in (a as object)) as {
      queries: string[];
    };
    expect(addon.queries).toContain('error');
    expect(container.textContent).toContain('1 result');
  });
});
