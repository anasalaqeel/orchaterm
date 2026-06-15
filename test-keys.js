const readline = require('readline');

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

console.log('Listening for raw keypresses. Press Ctrl+C to force exit.');

process.stdin.on('keypress', (str, key) => {
  console.log('Received:', {
    sequence: key.sequence ? Buffer.from(key.sequence).toString('hex') : null,
    name: key.name,
    ctrl: key.ctrl,
    meta: key.meta,
    shift: key.shift
  });

  if (key.ctrl && key.name === 'c') {
    process.exit(0);
  }
});
