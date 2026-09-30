// Shared WebdriverIO helpers for the Orchaterm E2E suite.
// UI assertions lean on page-source text (resilient to class-name churn);
// terminal assertions are file-based because xterm's WebGL renderer keeps
// text out of the DOM.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function waitForPageText(text, timeout = 45000) {
  await browser.waitUntil(
    async () => (await browser.getPageSource()).includes(text),
    { timeout, timeoutMsg: `Expected page to contain: "${text}"` }
  );
}

/**
 * Types a command into the newest visible terminal and presses Enter.
 *
 * Delivered as an xterm paste event: a paste is a single write_pty, while
 * WebDriver key actions double-process in xterm v6 ("echo" lands as
 * "eecchhoo" — keydown and input are both handled) and the embedded driver
 * doesn't map modifier key names. Runs inside the page so no element
 * references are held across React re-renders (stale-element safe).
 */
export async function runInTerminal(command) {
  const pasted = await browser.execute((cmd) => {
    const isShown = (el) => {
      let node = el;
      while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        node = node.parentElement;
      }
      return true;
    };
    // Last visible textarea = newest terminal (sessions render in creation order).
    const areas = [...document.querySelectorAll('.xterm-helper-textarea')].filter(isShown);
    const area = areas[areas.length - 1];
    if (!area) return false;
    area.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', cmd);
    area.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })
    );
    return true;
  }, command);
  if (!pasted) throw new Error('No visible terminal textarea to type into');
  await browser.keys('Enter');
}

/**
 * Windows shells take 1–3s to spawn after the tab appears; keystrokes typed
 * before the PTY attaches are dropped by the write path. Call this after a
 * tab is created and before typing into it.
 */
export async function waitTerminalReady() {
  await browser.pause(3000);
}

export async function newTab() {
  const launch = await $('button=Launch Terminal Session');
  if (await launch.isExisting()) {
    await launch.click();
    return;
  }
  const plus = await $('button[title^="New tab"]');
  await plus.click();
}

export async function sendChatMessage(text) {
  await browser.waitUntil(
    async () => {
      try {
        const sent = await browser.execute((message) => {
          const isShown = (el) => {
            let node = el;
            while (node && node !== document.body) {
              const cs = getComputedStyle(node);
              if (cs.display === 'none' || cs.visibility === 'hidden') return false;
              node = node.parentElement;
            }
            return true;
          };
          // The chat composer, not xterm's tiny helper textarea (which is
          // also a visible <textarea>).
          const area = [...document.querySelectorAll('textarea')].find(
            (a) => isShown(a) && (a.placeholder ?? '').includes('Ask anything')
          );
          if (!area) return false;
          area.focus();
          // React tracks the last value it set — write through the native
          // value setter or the controlled component never sees the change.
          const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value'
          ).set;
          setter.call(area, message);
          area.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }, text);
        if (!sent) return false;
        await browser.keys('Enter');
        return true;
      } catch (err) {
        if (!String(err?.message).includes('stale element')) throw err;
        return false;
      }
    },
    { timeout: 20000, timeoutMsg: 'Could not send chat message' }
  );
}

/** Polls a filesystem predicate from the Node side of the spec. */
export async function waitForFileCondition(check, timeout = 60000, everyMs = 500) {
  const deadline = Date.now() + timeout;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      if (check()) return true;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`File condition not met within ${timeout}ms${lastErr ? `: ${lastErr}` : ''}`);
}

export function tmpPath(...parts) {
  return path.join(repoRoot, 'e2e', '.tmp', ...parts);
}

export function fileContains(file, needle) {
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(needle);
}
