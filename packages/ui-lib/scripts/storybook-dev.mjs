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

const child = spawn('storybook', ['dev', '--host', '127.0.0.1', '-p', port, ...passthroughArgs], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
