import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyToClipboard, readFromClipboard } from '../utils/clipboard';

const mockClipboardPlugin = {
  writeText: vi.fn(),
  readText: vi.fn(),
};

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: (...args: any[]) => mockClipboardPlugin.writeText(...args),
  readText: (...args: any[]) => mockClipboardPlugin.readText(...args),
}));

describe('clipboard utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('copyToClipboard', () => {
    it('returns false for empty input', async () => {
      const result = await copyToClipboard('');
      expect(result).toBe(false);
      expect(mockClipboardPlugin.writeText).not.toHaveBeenCalled();
    });

    it('uses Tauri clipboard plugin when available', async () => {
      mockClipboardPlugin.writeText.mockResolvedValueOnce(undefined);
      const result = await copyToClipboard('test text');
      expect(result).toBe(true);
      expect(mockClipboardPlugin.writeText).toHaveBeenCalledWith('test text');
    });

    it('falls back to navigator.clipboard when Tauri plugin fails', async () => {
      mockClipboardPlugin.writeText.mockRejectedValueOnce(new Error('Tauri IPC error'));
      const navigatorWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: navigatorWriteText },
        configurable: true,
      });

      const result = await copyToClipboard('fallback text');
      expect(result).toBe(true);
      expect(navigatorWriteText).toHaveBeenCalledWith('fallback text');
    });

    it('falls back to execCommand when navigator.clipboard fails', async () => {
      mockClipboardPlugin.writeText.mockRejectedValueOnce(new Error('Tauri IPC error'));
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
        configurable: true,
      });

      const execMock = vi.fn().mockReturnValue(true);
      document.execCommand = execMock;

      const result = await copyToClipboard('execCommand text');
      expect(result).toBe(true);
      expect(execMock).toHaveBeenCalledWith('copy');
    });
  });

  describe('readFromClipboard', () => {
    it('reads text via Tauri plugin when available', async () => {
      mockClipboardPlugin.readText.mockResolvedValueOnce('clipboard content');
      const result = await readFromClipboard();
      expect(result).toBe('clipboard content');
      expect(mockClipboardPlugin.readText).toHaveBeenCalled();
    });

    it('falls back to navigator.clipboard when Tauri plugin fails', async () => {
      mockClipboardPlugin.readText.mockRejectedValueOnce(new Error('Tauri IPC error'));
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: vi.fn().mockResolvedValue('browser clipboard') },
        configurable: true,
      });

      const result = await readFromClipboard();
      expect(result).toBe('browser clipboard');
    });
  });
});
