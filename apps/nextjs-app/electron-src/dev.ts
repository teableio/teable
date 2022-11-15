import { join } from 'path';
import process from 'process';
import { startServer } from './server';
// start a dev server combine next & nest
const appDir = process.cwd() || join(__dirname, '../../../../');
console.log(appDir);
startServer({
  isDev: true,
  nextAppDir: appDir,
  callback: (port) => {
    console.log(`> Ready on http://localhost:${port}`);
  },
});
