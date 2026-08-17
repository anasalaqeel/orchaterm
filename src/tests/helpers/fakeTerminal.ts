/**
 * Shared fake xterm.js Terminal for component tests.
 *
 * Implements exactly the surface Orchaterm's TerminalTab touches, records
 * everything a test may want to assert (writes, pastes, clears, focus,
 * disposal), and exposes fire* methods so tests can drive the event handlers
 * the component registers (onData, onResize, custom key handler, kitty
 * protocol CSI handlers).
 */

export class FakeTerminal {
  // Terminal state a test can mutate before triggering an action.
  lines: string[] = [];
  selectionText = '';
  modes = { bracketedPasteMode: true };
  options: Record<string, unknown> = {};
  unicode = { activeVersion: '' };
  element: HTMLElement | null = null;
  cols = 80;
  rows = 24;

  // Recorded side effects.
  writes: string[] = [];
  pasted: string[] = [];
  cleared = 0;
  focused = 0;
  selectAllCalled = false;
  disposed = false;
  loadedAddons: unknown[] = [];

  // Handlers registered by the component under test.
  dataHandler: ((data: string) => void) | null = null;
  resizeHandler: ((d: { cols: number; rows: number }) => void) | null = null;
  selectionHandler: (() => void) | null = null;
  bellHandler: (() => void) | null = null;
  keyHandler: ((e: Record<string, unknown>) => boolean | undefined) | null = null;
  csiHandlers: Array<{ spec: { prefix?: string; final: string }; cb: (p: unknown[]) => boolean }> = [];
  escHandlers: Array<{ spec: { final: string }; cb: () => boolean }> = [];

  parser = {
    registerCsiHandler: (spec: { prefix?: string; final: string }, cb: (p: unknown[]) => boolean) => {
      this.csiHandlers.push({ spec, cb });
      return () => {};
    },
    registerEscHandler: (spec: { final: string }, cb: () => boolean) => {
      this.escHandlers.push({ spec, cb });
      return () => {};
    },
  };

  buffer: unknown;

  constructor(_opts?: unknown) {
    lastTerminal = this;
    const self = this;
    this.buffer = {
      active: {
        get length() { return self.lines.length; },
        getLine: (r: number) =>
          self.lines[r] !== undefined
            ? { translateToString: (trimRight: boolean) => (trimRight ? self.lines[r].trimEnd() : self.lines[r]) }
            : undefined,
      },
    };
  }

  open(el: HTMLElement) { this.element = el; }
  loadAddon(addon: unknown) { this.loadedAddons.push(addon); }

  onData(cb: (data: string) => void) {
    this.dataHandler = cb;
    return { dispose: () => { if (this.dataHandler === cb) this.dataHandler = null; } };
  }
  onSelectionChange(cb: () => void) {
    this.selectionHandler = cb;
    return { dispose: () => { if (this.selectionHandler === cb) this.selectionHandler = null; } };
  }
  onBell(cb: () => void) {
    this.bellHandler = cb;
    return { dispose: () => { if (this.bellHandler === cb) this.bellHandler = null; } };
  }
  onResize(cb: (d: { cols: number; rows: number }) => void) {
    this.resizeHandler = cb;
    return { dispose: () => { if (this.resizeHandler === cb) this.resizeHandler = null; } };
  }
  attachCustomKeyEventHandler(fn: (e: Record<string, unknown>) => boolean | undefined) {
    this.keyHandler = fn;
  }

  focus() { this.focused++; }
  write(data: string) { this.writes.push(data); }
  refresh(_start: number, _end: number) {}
  clear() { this.cleared++; }
  scrollToTop() {}
  scrollToBottom() {}
  paste(text: string) { this.pasted.push(text); }
  selectAll() { this.selectAllCalled = true; }
  hasSelection() { return this.selectionText !== ''; }
  getSelection() { return this.selectionText; }
  dispose() { this.disposed = true; }

  // ── Test triggers ──────────────────────────────────────────────────────────
  fireData(data: string) { this.dataHandler?.(data); }
  fireResize(cols: number, rows: number) { this.resizeHandler?.({ cols, rows }); }
  fireSelectionChange() { this.selectionHandler?.(); }
  fireKey(e: Record<string, unknown>): boolean | undefined {
    return this.keyHandler?.({ type: 'keydown', ...e }) as boolean | undefined;
  }
  fireCsi(prefix: string, final: string, params: unknown[]) {
    this.csiHandlers.find(h => h.spec.prefix === prefix && h.spec.final === final)?.cb(params);
  }
}

let lastTerminal: FakeTerminal | null = null;

/** The most recently constructed FakeTerminal (the one the component mounted). */
export function getLastTerminal(): FakeTerminal {
  if (!lastTerminal) throw new Error('No FakeTerminal instance was created yet');
  return lastTerminal;
}
