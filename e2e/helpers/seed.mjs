// Seeds the E2E app-data sandbox (%APPDATA%\com.orchaterm.app.e2e) before the
// app launches. The E2E build uses identifier com.orchaterm.app.e2e, so this
// never touches the real app's settings. Runs before every spec file so each
// spec starts from a known state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');const fixtureWorkspace = path.join(repoRoot, 'e2e', '.tmp', 'workspace');
const MOCK_PROVIDER = {
  provider: 'openai-compatible',
  model: 'mock-model',
  baseUrl: 'http://127.0.0.1:8899',
  apiKey: 'test',
};

const E2E_WORKSPACE_ID = 'e2e-ws';

export function seedSandbox() {
  const appData = process.env.APPDATA;
  if (!appData) throw new Error('E2E seeding requires APPDATA (Windows only for now)');

  const sandbox = path.join(appData, 'com.orchaterm.app.e2e');
  fs.mkdirSync(path.join(fixtureWorkspace, '.orchaterm'), { recursive: true });
  fs.mkdirSync(sandbox, { recursive: true });
  // Tabs persist per workspace — reset so no spec inherits another spec's tabs.
  fs.rmSync(path.join(sandbox, 'orchaterm_terminals.json'), { force: true });

  // Clean the workspace *contents*, never the workspace root: a shell from a
  // previous run may still have its CWD parked there and Windows locks a
  // directory that is any process's working directory. Its contents (and the
  // marker/log files beside it) carry no such lock.
  fs.rmSync(path.join(fixtureWorkspace, '.orchaterm'), { recursive: true, force: true });
  fs.mkdirSync(path.join(fixtureWorkspace, '.orchaterm'), { recursive: true });
  for (const f of ['echo-marker.txt', 'fake-agent.log']) {
    fs.rmSync(path.join(repoRoot, 'e2e', '.tmp', f), { force: true });
  }

  const now = new Date().toISOString();
  const data = {
    workspaces: [
      {
        id: E2E_WORKSPACE_ID,
        name: 'E2E Workspace',
        path: fixtureWorkspace,
        description: 'Fixture workspace for the WebdriverIO suite',
        color: '#2f8f7a',
        status: 'active',
        currentTask: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    spaces: [],
    taskLogs: [],
    savedPrompts: [],
    settings: {
      shellPath: '',
      conductorTaskTimeoutMinutes: 0,
      conductorInteractionMode: 'auto',
      llmProviderMode: 'simple',
      simpleLlmProvider: MOCK_PROVIDER,
      llmProviders: {
        relay: MOCK_PROVIDER,
        planGen: MOCK_PROVIDER,
        autoAnswer: MOCK_PROVIDER,
        chat: MOCK_PROVIDER,
        routing: MOCK_PROVIDER,
      },
      providerApiKeys: {},
      aiEnabled: true,
      continuation: { enabled: true, snapshotIntervalChars: 4000 },
    },
  };
  fs.writeFileSync(path.join(sandbox, 'orchaterm_data.json'), JSON.stringify(data, null, 2));
  fs.writeFileSync(
    path.join(sandbox, 'orchaterm_ui.json'),
    JSON.stringify({
      activeWorkspaceId: E2E_WORKSPACE_ID,
      activeSpaceId: null,
      viewMode: 'console',
    })
  );

  return { sandbox, workspacePath: fixtureWorkspace };
}
