import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    // Scope discovery to this project's sources — the repo can contain git
    // worktrees (e.g. .kilo/worktrees/*) whose tests must not run here.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
