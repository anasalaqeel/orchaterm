/**
 * Real integration test for the ghostty-web terminal.
 *
 * Unlike the pure-helper unit tests, this one loads the ACTUAL ghostty-vt.wasm
 * (the same ~400KB Zig core shipped to production), instantiates a real
 * `Terminal`, and verifies the API surface TerminalTab relies on:
 * write → buffer, onData, selection, hasBracketedPaste, FitAddon, link/key
 * handler registration, and option handling.
 *
 * jsdom has no real <canvas>/WebGL and no ResizeObserver, so we stub only
 * those (a Proxy 2D-context + RO/rAF polyfills). The WASM execution, VT
 * parsing, screen model and event wiring are all real.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Ghostty, Terminal, FitAddon } from 'ghostty-web';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WASM_PATH = resolve(process.cwd(), 'node_modules/ghostty-web/ghostty-vt.wasm');

let ghostty: Awaited<ReturnType<typeof Ghostty.load>>;
// Saved in beforeAll, restored in afterAll (declared here so afterAll can see it).
let originalFetch: any;

beforeAll(async () => {
  // --- jsdom polyfills ghostty-web's renderer/input touch -------------------
  const noop = () => {};
  // A permissive CanvasRenderingContext2D stand-in: any method is a no-op,
  // measureText returns a fixed width so the renderer can "measure" cells.
  const stubCtx = () =>
    new Proxy(
      { canvas: null },
      {
        get: (target, prop) => {
          if (prop in target) return (target as any)[prop];
          if (prop === 'measureText') return () => ({ width: 7.2 });
          if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
          return noop;
        },
        set: () => true,
      },
    );
  // getContext lives on the prototype — override once for every canvas.
  (globalThis as any).HTMLCanvasElement.prototype.getContext = function () {
    return stubCtx();
  };
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    };
  }
  if (!(globalThis as any).requestAnimationFrame) {
    (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(performance.now()), 0);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
  }
  if (!(globalThis as any).devicePixelRatio) (globalThis as any).devicePixelRatio = 1;

  // --- serve the real WASM bytes to Ghostty.load via fetch ------------------
  // ghostty-web's loader (Bun → fs → fetch) doesn't resolve a bare Windows
  // path, so intercept fetch for the wasm and return the bytes read from disk.
  // The wasm execution, VT parsing and screen model are then 100% real.
  originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (input: any) => {
    if (String(input).includes('ghostty-vt.wasm')) {
      const buf = readFileSync(WASM_PATH);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    }
    if (typeof originalFetch === 'function') return originalFetch(input);
    throw new Error(`unexpected fetch in test: ${input}`);
  };

  ghostty = await Ghostty.load(WASM_PATH);
}, 30_000);

afterAll(() => {
  // Restore fetch so the wasm-serving mock can't leak to other test files.
  if (originalFetch !== undefined) (globalThis as any).fetch = originalFetch;
});

/** Read every line of the active buffer as plain text. */
function bufferText(term: Terminal): string {
  const out: string[] = [];
  const buf = term.buffer.active;
  for (let y = 0; y < buf.length; y++) {
    out.push(buf.getLine(y)?.translateToString(true) ?? '');
  }
  return out.join('\n');
}

describe('ghostty-web runtime integration', () => {
  it('loads the real WASM core', () => {
    expect(ghostty).toBeTruthy();
  });

  it('writes text into the screen buffer', () => {
    const term = new Terminal({ ghostty, cols: 40, rows: 6 });
    term.open(document.createElement('div'));
    term.write('hello world');
    // The wasm terminal processes the bytes synchronously; the buffer reflects.
    expect(bufferText(term)).toContain('hello world');
    term.dispose();
  });

  it('parses ANSI escapes (color) without leaking codes into the text', () => {
    const term = new Terminal({ ghostty, cols: 40, rows: 6 });
    term.open(document.createElement('div'));
    term.write('\x1b[31mred\x1b[0m text');
    const text = bufferText(term);
    expect(text).toContain('red');
    expect(text).toContain('text');
    expect(text).not.toContain('\x1b[31m'); // escape consumed, not printed
    term.dispose();
  });

  it('exposes the API surface TerminalTab depends on', () => {
    const term = new Terminal({ ghostty, cols: 40, rows: 6 });
    term.open(document.createElement('div'));
    expect(typeof term.onData).toBe('function');
    expect(typeof term.onResize).toBe('function');
    expect(typeof term.onSelectionChange).toBe('function');
    expect(typeof term.onBell).toBe('function');
    expect(typeof term.attachCustomKeyEventHandler).toBe('function');
    expect(typeof term.registerLinkProvider).toBe('function');
    expect(typeof term.hasBracketedPaste).toBe('function');
    expect(typeof term.clear).toBe('function');
    expect(typeof term.scrollToBottom).toBe('function');
    expect(typeof term.paste).toBe('function');
    expect(typeof term.getSelection).toBe('function');
    expect(typeof term.dispose).toBe('function');

    // Events return IDisposable (the pattern TerminalTab relies on).
    const d = term.onData(() => {});
    expect(typeof d.dispose).toBe('function');
    d.dispose();

    // registerLinkProvider must accept our provider shape without throwing.
    expect(() =>
      term.registerLinkProvider({
        provideLinks(_y: number, cb: (links: any) => void) {
          cb(undefined);
        },
      }),
    ).not.toThrow();

    // attachCustomKeyEventHandler must accept the handler.
    expect(() => term.attachCustomKeyEventHandler(() => true)).not.toThrow();
    term.dispose();
  });

  it('selection API works (selectAll / hasSelection / getSelection)', () => {
    const term = new Terminal({ ghostty, cols: 40, rows: 6 });
    term.open(document.createElement('div'));
    term.write('alpha bravo charlie');
    expect(term.hasSelection()).toBe(false);
    term.selectAll();
    expect(term.hasSelection()).toBe(true);
    expect(term.getSelection()).toContain('alpha');
    term.dispose();
  });

  it('hasBracketedPaste() returns a boolean (TerminalTab quick-actions use it)', () => {
    const term = new Terminal({ ghostty, cols: 40, rows: 6 });
    term.open(document.createElement('div'));
    expect(typeof term.hasBracketedPaste()).toBe('boolean');
    term.dispose();
  });

  it('FitAddon attaches and proposeDimensions() does not throw', () => {
    const term = new Terminal({ ghostty, cols: 40, rows: 6 });
    term.open(document.createElement('div'));
    const fit = new FitAddon();
    term.loadAddon(fit);
    // proposeDimensions may return undefined without a laid-out DOM; the
    // guarantee we need is that it (and fit()) don't throw.
    expect(() => fit.proposeDimensions()).not.toThrow();
    expect(() => fit.fit()).not.toThrow();
    term.dispose();
  });

  it('honors constructor theme options without error', () => {
    const theme = {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ff0000',
      red: '#ff0000',
      green: '#00ff00',
    };
    const term = new Terminal({ ghostty, cols: 10, rows: 3, theme });
    term.open(document.createElement('div'));
    expect(term.options.theme.background).toBe('#000000');
    term.dispose();
  });
});

// Sanity: the WASM bytes are where we expect (catches a moved asset early).
describe('wasm asset path', () => {
  it('exists at node_modules/ghostty-web/ghostty-vt.wasm', () => {
    const bytes = readFileSync(WASM_PATH);
    // 400KB+ — confirms it's the real Ghostty VT core, not a stub.
    expect(bytes.length).toBeGreaterThan(100_000);
    expect(bytes[0]).toBe(0x00); // WebAssembly magic: 0x00 0x61 0x73 0x6d
    expect(bytes[1]).toBe(0x61);
    expect(bytes[2]).toBe(0x73);
    expect(bytes[3]).toBe(0x6d);
  });
});
