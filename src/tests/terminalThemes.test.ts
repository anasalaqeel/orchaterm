import { describe, it, expect, vi } from 'vitest';
import { Terminal } from 'xterm';
import { buildCombo, resolveTerminalKey, mergeTerminalConfig, DEFAULT_TERMINAL_CONFIG, kittyEncodeKey, attachKittyProtocol } from '../utils/terminalThemes';
import type { TerminalKeybinding } from '../types';

function makeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: '',
    ...overrides,
  } as KeyboardEvent;
}

describe('buildCombo', () => {
  it('single modifier + letter', () => {
    expect(buildCombo(makeEvent({ ctrlKey: true, key: 'k' }))).toBe('ctrl+k');
  });

  it('multiple modifiers + letter', () => {
    expect(buildCombo(makeEvent({ ctrlKey: true, shiftKey: true, key: 't' }))).toBe('ctrl+shift+t');
  });

  it('alt + letter', () => {
    expect(buildCombo(makeEvent({ altKey: true, key: 'b' }))).toBe('alt+b');
  });

  it('modifier key only', () => {
    expect(buildCombo(makeEvent({ ctrlKey: true, key: 'Control' }))).toBe('ctrl');
  });

  it('no modifiers — bare key', () => {
    expect(buildCombo(makeEvent({ key: 'enter' }))).toBe('enter');
  });

  it('function key lowercased', () => {
    expect(buildCombo(makeEvent({ key: 'F5' }))).toBe('f5');
  });

  it('modifier order is canonical ctrl→alt→shift→meta', () => {
    expect(
      buildCombo(makeEvent({ shiftKey: true, ctrlKey: true, metaKey: true, key: 'p' }))
    ).toBe('ctrl+shift+meta+p');
  });
});

describe('resolveTerminalKey', () => {
  const copy: TerminalKeybinding = { key: 'ctrl+shift+c', action: 'copy' };
  const pass: TerminalKeybinding = { key: 'ctrl+r', action: 'passthrough' };

  it('empty keybindings → null (pure passthrough default)', () => {
    expect(resolveTerminalKey('ctrl+r', [])).toBeNull();
    expect(resolveTerminalKey('ctrl+l', [])).toBeNull();
  });

  it('configured action combo → returns the binding', () => {
    expect(resolveTerminalKey('ctrl+shift+c', [copy])).toBe(copy);
  });

  it('passthrough binding → returns binding with passthrough action', () => {
    const result = resolveTerminalKey('ctrl+r', [pass]);
    expect(result?.action).toBe('passthrough');
  });

  it('non-matching combo with a populated table → null', () => {
    expect(resolveTerminalKey('ctrl+x', [copy, pass])).toBeNull();
  });
});

describe('kittyEncodeKey', () => {
  it('flags 0 → null (protocol inactive, use legacy)', () => {
    expect(kittyEncodeKey(makeEvent({ ctrlKey: true, key: 'd' }), 0)).toBeNull();
  });

  it('disambiguate bit unset (flags 4) → null', () => {
    expect(kittyEncodeKey(makeEvent({ ctrlKey: true, key: 'd' }), 4)).toBeNull();
  });

  it('disambiguate bit set within combined flags (5 = 1|4) → encodes', () => {
    expect(kittyEncodeKey(makeEvent({ ctrlKey: true, key: 'd' }), 5)).toBe('\x1b[100;5u');
  });

  it('Ctrl+D with disambiguate flag → CSI-u (codepoint 100, mods 5)', () => {
    expect(kittyEncodeKey(makeEvent({ ctrlKey: true, key: 'd' }), 1)).toBe('\x1b[100;5u');
  });

  it('Ctrl+C → codepoint 99', () => {
    expect(kittyEncodeKey(makeEvent({ ctrlKey: true, key: 'c' }), 1)).toBe('\x1b[99;5u');
  });

  it('Ctrl+Shift+D → shift adds to modifier (mods 6), base codepoint', () => {
    expect(kittyEncodeKey(makeEvent({ ctrlKey: true, shiftKey: true, key: 'D' }), 1)).toBe('\x1b[100;6u');
  });

  it('no Ctrl → null (plain typing untouched)', () => {
    expect(kittyEncodeKey(makeEvent({ key: 'd' }), 1)).toBeNull();
  });

  it('Ctrl+Alt with no getModifierState (AltGr on Windows) → null, conservatively', () => {
    expect(kittyEncodeKey(makeEvent({ ctrlKey: true, altKey: true, key: 'd' }), 1)).toBeNull();
  });

  it('Ctrl+Alt confirmed NOT AltGraph → encodes (mods 7: shift0+alt2+ctrl4, +1)', () => {
    const e = makeEvent({ ctrlKey: true, altKey: true, key: 'd' });
    (e as any).getModifierState = (name: string) => name === 'AltGraph' ? false : false;
    expect(kittyEncodeKey(e, 1)).toBe('\x1b[100;7u');
  });

  it('Ctrl+Alt confirmed AltGraph via getModifierState → null', () => {
    const e = makeEvent({ ctrlKey: true, altKey: true, key: 'd' });
    (e as any).getModifierState = (name: string) => name === 'AltGraph';
    expect(kittyEncodeKey(e, 1)).toBeNull();
  });

  it('meta held → null', () => {
    expect(kittyEncodeKey(makeEvent({ ctrlKey: true, metaKey: true, key: 'd' }), 1)).toBeNull();
  });

  it('plain Enter (no modifiers) → null (legacy \\r is unambiguous)', () => {
    expect(kittyEncodeKey(makeEvent({ key: 'Enter' }), 1)).toBeNull();
  });

  it('Shift+Enter → CSI-u (codepoint 13, mods 2) — the actual AI-agent bug', () => {
    expect(kittyEncodeKey(makeEvent({ shiftKey: true, key: 'Enter' }), 1)).toBe('\x1b[13;2u');
  });

  it('Ctrl+Enter → CSI-u (codepoint 13, mods 5)', () => {
    expect(kittyEncodeKey(makeEvent({ ctrlKey: true, key: 'Enter' }), 1)).toBe('\x1b[13;5u');
  });

  it('Alt+Enter → CSI-u (codepoint 13, mods 3)', () => {
    expect(kittyEncodeKey(makeEvent({ altKey: true, key: 'Enter' }), 1)).toBe('\x1b[13;3u');
  });

  it('Shift+Tab → CSI-u (codepoint 9, mods 2)', () => {
    expect(kittyEncodeKey(makeEvent({ shiftKey: true, key: 'Tab' }), 1)).toBe('\x1b[9;2u');
  });

  it('Ctrl+Backspace → CSI-u (codepoint 127, mods 5)', () => {
    expect(kittyEncodeKey(makeEvent({ ctrlKey: true, key: 'Backspace' }), 1)).toBe('\x1b[127;5u');
  });

  it('plain Tab/Backspace (no modifiers) → null (legacy byte is unambiguous)', () => {
    expect(kittyEncodeKey(makeEvent({ key: 'Tab' }), 1)).toBeNull();
    expect(kittyEncodeKey(makeEvent({ key: 'Backspace' }), 1)).toBeNull();
  });

  it('plain Escape (no modifiers) → CSI-u (codepoint 27, mods 1) — always disambiguated', () => {
    // A bare \x1b is inherently ambiguous with "start of an escape sequence"
    // (the classic vim Escape-key-lag problem). Unlike Enter/Tab/Backspace,
    // the disambiguate flag requires Escape to always be CSI-u encoded.
    expect(kittyEncodeKey(makeEvent({ key: 'Escape' }), 1)).toBe('\x1b[27;1u');
  });

  it('Ctrl+Escape → CSI-u (codepoint 27, mods 5)', () => {
    expect(kittyEncodeKey(makeEvent({ ctrlKey: true, key: 'Escape' }), 1)).toBe('\x1b[27;5u');
  });
});

describe('attachKittyProtocol', () => {
  // Feeds a raw escape sequence through xterm.js's real VT parser and waits
  // for it to finish — this exercises the actual production CSI-handler
  // registrations (not a re-implementation), the same way a PTY-side app
  // enabling the protocol would. Runs headless: no .open()/DOM needed since
  // parsing is independent of rendering.
  function write(term: Terminal, data: string): Promise<void> {
    return new Promise((resolve) => term.write(data, resolve));
  }

  it('starts at flags 0', () => {
    const term = new Terminal();
    const kitty = attachKittyProtocol(term, () => {});
    expect(kitty.getFlags()).toBe(0);
    term.dispose();
  });

  it('CSI > flags u sets flags', async () => {
    const term = new Terminal();
    const kitty = attachKittyProtocol(term, () => {});
    await write(term, '\x1b[>1u');
    expect(kitty.getFlags()).toBe(1);
    term.dispose();
  });

  it('CSI = flags u (mode 1, default) replaces flags outright', async () => {
    const term = new Terminal();
    const kitty = attachKittyProtocol(term, () => {});
    await write(term, '\x1b[=5u');
    expect(kitty.getFlags()).toBe(5);
    term.dispose();
  });

  it('CSI = flags ; 2 u ORs bits into the current flags', async () => {
    const term = new Terminal();
    const kitty = attachKittyProtocol(term, () => {});
    await write(term, '\x1b[=1u');
    await write(term, '\x1b[=2;2u');
    expect(kitty.getFlags()).toBe(3);
    term.dispose();
  });

  it('CSI = flags ; 3 u clears bits from the current flags', async () => {
    const term = new Terminal();
    const kitty = attachKittyProtocol(term, () => {});
    await write(term, '\x1b[=3u');
    await write(term, '\x1b[=1;3u');
    expect(kitty.getFlags()).toBe(2);
    term.dispose();
  });

  it('CSI > u pushes, CSI < u pops back to the prior value (nvim/fzf pattern)', async () => {
    const term = new Terminal();
    const kitty = attachKittyProtocol(term, () => {});
    await write(term, '\x1b[>1u');
    await write(term, '\x1b[>3u');
    expect(kitty.getFlags()).toBe(3);
    await write(term, '\x1b[<u');
    expect(kitty.getFlags()).toBe(1);
    await write(term, '\x1b[<u');
    expect(kitty.getFlags()).toBe(0);
    term.dispose();
  });

  it('CSI ? u queries the active flags via writeReply', async () => {
    const term = new Terminal();
    const writeReply = vi.fn();
    attachKittyProtocol(term, writeReply);
    await write(term, '\x1b[>5u');
    await write(term, '\x1b[?u');
    expect(writeReply).toHaveBeenCalledWith('\x1b[?5u');
    term.dispose();
  });

  it('alt-screen exit (CSI ? 1049 l) resets flags — prevents Ctrl+C from getting stuck', async () => {
    const term = new Terminal();
    const kitty = attachKittyProtocol(term, () => {});
    await write(term, '\x1b[>1u');
    expect(kitty.getFlags()).toBe(1);
    await write(term, '\x1b[?1049l');
    expect(kitty.getFlags()).toBe(0);
    term.dispose();
  });

  it('alt-screen entry (CSI ? 1049 h) does NOT reset flags', async () => {
    const term = new Terminal();
    const kitty = attachKittyProtocol(term, () => {});
    await write(term, '\x1b[>1u');
    await write(term, '\x1b[?1049h');
    expect(kitty.getFlags()).toBe(1);
    term.dispose();
  });

  it('full reset (ESC c / RIS) resets flags', async () => {
    const term = new Terminal();
    const kitty = attachKittyProtocol(term, () => {});
    await write(term, '\x1b[>1u');
    await write(term, '\x1bc');
    expect(kitty.getFlags()).toBe(0);
    term.dispose();
  });

  it('reset() clears flags and the push/pop stack', async () => {
    const term = new Terminal();
    const kitty = attachKittyProtocol(term, () => {});
    await write(term, '\x1b[>1u');
    await write(term, '\x1b[>3u');
    kitty.reset();
    expect(kitty.getFlags()).toBe(0);
    await write(term, '\x1b[<u'); // pop with an empty stack — must stay at 0
    expect(kitty.getFlags()).toBe(0);
    term.dispose();
  });
});

describe('mergeTerminalConfig', () => {
  const combos = (kb: TerminalKeybinding[]) => kb.map(b => `${b.key}:${b.action}`).sort();

  it('no saved config → full defaults', () => {
    expect(combos(mergeTerminalConfig(undefined).keybindings))
      .toEqual(combos(DEFAULT_TERMINAL_CONFIG.keybindings));
  });

  it('saved config missing copy → copy backfilled, no duplicates', () => {
    const merged = mergeTerminalConfig({ keybindings: [{ key: 'ctrl+shift+v', action: 'paste' }] });
    expect(combos(merged.keybindings)).toContain('ctrl+shift+c:copy');
    expect(combos(merged.keybindings)).toContain('ctrl+shift+v:paste');
    // exactly one entry per combo
    expect(merged.keybindings.filter(b => b.key === 'ctrl+shift+v')).toHaveLength(1);
  });

  it('user override of a default combo is respected (not clobbered)', () => {
    const merged = mergeTerminalConfig({
      keybindings: [{ key: 'ctrl+shift+c', action: 'passthrough' }],
    });
    const c = merged.keybindings.filter(b => b.key === 'ctrl+shift+c');
    expect(c).toHaveLength(1);
    expect(c[0].action).toBe('passthrough');
  });
});
