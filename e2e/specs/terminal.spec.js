// A spawned terminal runs a real shell: a command typed into xterm produces a
// file on disk (WebGL renderer keeps output out of the DOM, so assertions go
// through the filesystem). Uses the tab the app auto-creates on console open.
import fs from 'node:fs';
import {
  runInTerminal,
  tmpPath,
  waitTerminalReady,
  waitForFileCondition,
  waitForPageText,
} from '../helpers/ui.mjs';

describe('terminal session', () => {
  it('spawns a shell and executes a typed command', async () => {
    await waitTerminalReady();
    await waitForPageText('New tab');

    const markerFile = tmpPath('echo-marker.txt');
    fs.rmSync(markerFile, { force: true });
    const shellPath = markerFile.replace(/\\/g, '/');

    // Works in PowerShell and bash alike; encoding asserted null-tolerant
    // (PowerShell 5.1 redirects as UTF-16).
    await runInTerminal(`echo orchaterm-e2e-done > ${shellPath}`);

    await waitForFileCondition(() => fs.existsSync(markerFile), 30000);
    const content = fs.readFileSync(markerFile, 'utf8').replace(/\0/g, '').trim();
    if (!content.includes('orchaterm-e2e-done')) {
      throw new Error(`Marker file has unexpected content: "${content}"`);
    }
  });
});
