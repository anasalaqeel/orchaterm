// App boots into the console view with the seeded workspace and the chat
// drawer ready — the foundation every other spec relies on.
//
// Note: the chat feed is never "empty" at boot — the ambient orchestrator
// posts a shell-prompt notification — so the empty-state title is not
// asserted; the composer placeholder is the chat-drawer signal.
import { waitForPageText } from '../helpers/ui.mjs';

describe('app boot', () => {
  it('shows the seeded workspace and the chat drawer', async () => {
    // Console view renders the seeded workspace name (tab strip / sidebar)
    await waitForPageText('E2E Workspace');

    // Chat drawer expanded, on the chat tab, composer ready
    await waitForPageText('Ask anything or describe a goal');
  });
});
