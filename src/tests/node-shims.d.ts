/**
 * Ambient declarations for the Node builtins used by the ghostty-web runtime
 * integration test (`ghosttyWeb.integration.test.ts`).
 *
 * This project intentionally has no `@types/node` (see the `@ts-expect-error`
 * in vite.config.ts), so rather than introduce a global types package that
 * could clash with the DOM lib (timer return types, etc.), we declare only the
 * exact surface the test touches. If `@types/node` is ever added, delete this
 * file.
 */
declare module 'node:fs' {
  export interface FsBuffer {
    buffer: ArrayBuffer;
    byteOffset: number;
    byteLength: number;
    /** Number of bytes (Buffer exposes both `length` and `byteLength`). */
    length: number;
    /** Byte at an index (for magic-number assertions). */
    [index: number]: number;
  }
  export function readFileSync(path: string): FsBuffer;
}

declare module 'node:path' {
  export function resolve(...pathSegments: string[]): string;
}

declare const process: {
  cwd(): string;
};
