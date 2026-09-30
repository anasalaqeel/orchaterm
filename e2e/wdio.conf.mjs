import { execSync } from 'node:child_process';
import { startLlmMock, stopLlmMock } from './mocks/llm-server.mjs';
import { seedSandbox } from './helpers/seed.mjs';

// A crashed or leaked app instance from a previous run would hold the fixture
// workspace as its shells' CWD (blocking cleanup) and fight the new run for
// the WebDriver port. Its Job Object takes the shell tree down with it.
function killStaleE2eApp() {
  try {
    execSync('taskkill /F /IM orchaterm-e2e.exe /T', { stdio: 'ignore' });
  } catch {
    // taskkill exits non-zero when no matching process exists — that's fine.
  }
  // taskkill returns before the process is fully gone; the dying app's
  // settings save must land BEFORE the sandbox is reseeded, otherwise it
  // resurrects the previous run's tabs into the next session.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const out = execSync('tasklist /FI "IMAGENAME eq orchaterm-e2e.exe"', {
        encoding: 'utf8',
      });
      if (!out.includes('orchaterm-e2e.exe')) return;
    } catch {
      return;
    }
    // Synchronous 300ms wait between polls.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
}

export const config = {
  runner: 'local',
  specs: ['./specs/**/*.spec.js'],
  maxInstances: 1,

  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: './src-tauri/target/debug/orchaterm-e2e.exe',
      },
    },
  ],

  services: [
    ['@wdio/tauri-service', { driverProvider: 'embedded' }],
  ],

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    timeout: 120000,
  },

  // Seed the isolated app-data sandbox before every spec-file session so each
  // spec starts from a known state, and keep the mock LLM up for the run.
  // NOTE: stale-app cleanup must stay in onPrepare — beforeSession runs AFTER
  // the service has already spawned this session's app.
  beforeSession: () => {
    seedSandbox();
  },
  onPrepare: async () => {
    killStaleE2eApp();
    seedSandbox();
    await startLlmMock();
  },
  onComplete: async () => {
    await stopLlmMock();
  },
};
