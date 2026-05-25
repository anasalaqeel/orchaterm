import { describe, it, expect } from 'vitest';
import { canInjectNow } from '../utils/interruptPolicy';

describe('canInjectNow', () => {
  describe('policy: always', () => {
    it('returns true regardless of buffer', () => {
      expect(canInjectNow('agent is working...', 'always')).toBe(true);
      expect(canInjectNow('', 'always')).toBe(true);
    });
  });

  describe('policy: never', () => {
    it('returns false regardless of buffer', () => {
      expect(canInjectNow('$ ', 'never')).toBe(false);
      expect(canInjectNow('', 'never')).toBe(false);
    });
  });

  describe('policy: prompt-only', () => {
    it('returns true when buffer ends with a bash $ prompt', () => {
      expect(canInjectNow('some output\n$ ', 'prompt-only')).toBe(true);
    });

    it('returns true when buffer ends with PowerShell > prompt', () => {
      expect(canInjectNow('PS C:\\> ', 'prompt-only')).toBe(true);
    });

    it('returns true when buffer ends with zsh ❯ prompt', () => {
      expect(canInjectNow('output\n❯ ', 'prompt-only')).toBe(true);
    });

    it('returns false when buffer shows mid-work output (no prompt)', () => {
      expect(canInjectNow('Installing dependencies...\nFetching packages', 'prompt-only')).toBe(false);
    });

    it('returns false for empty buffer', () => {
      expect(canInjectNow('', 'prompt-only')).toBe(false);
    });

    it('strips ANSI codes before checking', () => {
      const ansiPrompt = 'output\n\x1b[32m$\x1b[0m ';
      expect(canInjectNow(ansiPrompt, 'prompt-only')).toBe(true);
    });
  });
});
