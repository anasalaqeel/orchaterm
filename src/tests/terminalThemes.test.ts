import { describe, it, expect } from 'vitest';
import { buildCombo, resolveTerminalKey, mergeTerminalConfig, DEFAULT_TERMINAL_CONFIG } from '../utils/terminalThemes';
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
