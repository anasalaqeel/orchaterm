import { describe, it, expect } from 'vitest';
import { buildCombo } from '../utils/terminalThemes';

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
