// The full handover flow: the auto-created tab's work is handed to a second
// tab running a fake agent. The chat command drives it, the dialog confirm is
// clicked, and proof of delivery is the fake agent's log — it records every
// line arriving through its PTY, including the resume prompt.
import path from 'node:path';
import {
  newTab,
  repoRoot,
  runInTerminal,
  sendChatMessage,
  tmpPath,
  waitTerminalReady,
  waitForFileCondition,
  waitForPageText,
  fileContains,
} from '../helpers/ui.mjs';

const logPath = tmpPath('fake-agent.log');
const agentScript = path.join(repoRoot, 'e2e', 'fixtures', 'fake-agent.mjs').replace(/\\/g, '/');

describe('agent handover', () => {
  it("passes a tab's work to another tab after confirm", async () => {
    // Tab A — the app's auto-created tab (title " 1"). Tab B — runs the fake
    // agent as the handover destination.
    await waitTerminalReady();
    await waitForPageText('New tab');

    await newTab();
    await waitForPageText('PowerShell');
    await waitTerminalReady();
    await runInTerminal(`node ${agentScript} ${logPath.replace(/\\/g, '/')}`);

    await waitForFileCondition(() => fileContains(logPath, 'fake-agent up'), 30000, 300);

    // Hand over tab A's work to the agent tab via the chat cockpit.
    await sendChatMessage('/command pass 1 work to PowerShell');
    await waitForPageText('Pass work to another terminal');

    const confirmBtn = await $('button=Pass & Resume');
    await confirmBtn.click();

    // The fake agent must receive the resume prompt through its PTY.
    await waitForFileCondition(
      () => fileContains(logPath, 'Checkpoint file:'),
      90000,
      500
    );
    if (!fileContains(logPath, 'got: Continue working')) {
      throw new Error('Agent log has the checkpoint line but not the resume prompt');
    }
  });
});
