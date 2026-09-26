import { spawn } from 'node:child_process';

const rawArgs = process.argv.slice(2).filter((arg) => arg !== '--');
const passthroughArgs = [];
let port = '6006';

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];

  if ((arg === '--port' || arg === '-p') && rawArgs[index + 1]) {
    port = rawArgs[index + 1];
    index += 1;
    continue;
  }

  if (arg.startsWith('--port=')) {
    port = arg.slice('--port='.length);
    continue;
  }

  passthroughArgs.push(arg);
}

// Sonar S4036 (reported on the command-name argument): developer/CLI script on a trusted machine; the executable is resolved through PATH by design
const child = spawn(
  'storybook', // NOSONAR javascript:S4036 -- executable resolved through PATH by design (see above)
  ['dev', '--host', '127.0.0.1', '-p', port, ...passthroughArgs],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
