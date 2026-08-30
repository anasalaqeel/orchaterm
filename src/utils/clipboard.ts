import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * Copies text to the clipboard using a multi-tier fallback strategy:
 * 1. Native Tauri clipboard manager plugin
 * 2. Web standard navigator.clipboard API
 * 3. Legacy document.execCommand('copy') via a temporary off-screen textarea
 *
 * @param text The text string to copy
 * @returns Promise<boolean> true if copying succeeded, false otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try Tauri native clipboard plugin
  try {
    await writeText(text);
    return true;
  } catch {
    // 2. Fall back to standard browser Clipboard API
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // 3. Fall back to DOM execCommand
      try {
        if (typeof document !== 'undefined') {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          textarea.style.pointerEvents = 'none';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          const success = document.execCommand('copy');
          document.body.removeChild(textarea);
          if (success) return true;
        }
      } catch {}
    }
  }

  return false;
}

/**
 * Reads text from the clipboard using a multi-tier fallback strategy:
 * 1. Native Tauri clipboard manager plugin
 * 2. Web standard navigator.clipboard API
 *
 * @returns Promise<string> the copied text string, or empty string on failure
 */
export async function readFromClipboard(): Promise<string> {
  // 1. Try Tauri native clipboard plugin
  try {
    const text = await readText();
    if (typeof text === 'string') return text;
  } catch {
    // 2. Fall back to standard browser Clipboard API
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        return await navigator.clipboard.readText();
      }
    } catch {}
  }

  return '';
}
