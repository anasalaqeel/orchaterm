// Chat cockpit commands: deterministic status answer and a real checkpoint
// file written through the app's checkpoint pipeline (mock LLM provides the
// summary; the file path assertions are real). The auto-created tab is the
// command target.
import fs from 'node:fs';
import path from 'node:path';
import { sendChatMessage, tmpPath, waitTerminalReady, waitForPageText } from '../helpers/ui.mjs';

const CHECKPOINTS_DIR = path.join(tmpPath('workspace'), '.orchaterm', 'checkpoints');

describe('chat commands', () => {
  it('answers a status command with the open tabs', async () => {
    await waitTerminalReady();
    await waitForPageText('New tab');

    await sendChatMessage("/command what's running");
    await waitForPageText('Current tabs:');
  });

  it('checkpoints a tab on request', async () => {
    await sendChatMessage('/command checkpoint');
    await waitForPageText('Checkpoint saved:');

    await browser.waitUntil(
      () =>
        fs.existsSync(CHECKPOINTS_DIR) &&
        fs.readdirSync(CHECKPOINTS_DIR).some((f) => f.endsWith('.md')),
      { timeout: 30000, timeoutMsg: 'Expected a checkpoint .md in the fixture workspace' }
    );
  });
});
