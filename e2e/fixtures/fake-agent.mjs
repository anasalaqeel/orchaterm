// A deterministic stand-in "coding agent" for handover E2E tests.
// Usage: node fake-agent.mjs <log-file>
// Prints a banner so the terminal looks busy, then echoes every stdin line
// into the log file — specs assert the resume prompt arrived by reading it.
import fs from 'node:fs';

const logPath = process.argv[2];
if (!logPath) {
  console.error('usage: node fake-agent.mjs <log-file>');
  process.exit(1);
}

fs.writeFileSync(logPath, `fake-agent up pid=${process.pid}\n`);
console.log('FAKE AGENT READY — waiting for input');

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    fs.appendFileSync(logPath, `got: ${line}\n`);
    console.log(`FAKE AGENT ACK: ${line.slice(0, 60)}`);
  }
});
process.stdin.resume();
// When the owning PTY dies, stdin closes — exit instead of becoming an orphan
// that holds files open.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
