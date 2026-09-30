// Runs each spec file as its own `wdio run` invocation so every spec gets a
// freshly spawned app and a freshly seeded sandbox — the tauri-service keeps
// one app alive per invocation and reconnects across spec files otherwise,
// which would leak tabs/chat state between specs.
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const specsDir = join(e2eDir, 'specs');
const specs = readdirSync(specsDir)
  .filter((f) => f.endsWith('.spec.js'))
  .sort();

if (specs.length === 0) {
  console.error('No spec files found in', specsDir);
  process.exit(1);
}

const failed = [];
for (const spec of specs) {
  console.log(`\n========== ${spec} ==========\n`);
  const res = spawnSync(
    'bunx',
    ['wdio', 'run', 'e2e/wdio.conf.mjs', '--spec', `e2e/specs/${spec}`],
    { stdio: 'inherit', shell: true }
  );
  if (res.status !== 0) failed.push(spec);
}

if (failed.length > 0) {
  console.error(`\nFAILED SPECS: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('\nALL SPECS PASSED');
