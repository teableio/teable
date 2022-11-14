// Native

// Packages
import { createServer } from 'http';
import { join } from 'path';
import { parse } from 'url';
import { app, BrowserWindow, ipcMain } from 'electron';
import type { IpcMainEvent } from 'electron';
import isDev from 'electron-is-dev';
import log from 'electron-log';
import isPortReachable from 'is-port-reachable';
import next from 'next';
import { bootstrap } from '../server-src';
// import fs from 'fs';

const nextAppDir = app.getAppPath();
const nextApp = next({ dev: isDev, dir: nextAppDir });
const handle = nextApp.getRequestHandler();
log.info('log ok');
const defaultNextPort = 3000;
const defaultNestServerPort = 4000;

async function getReachablePort(dPort: number): Promise<number> {
  let port = dPort;
  while (await isPortReachable(port, { host: 'localhost' })) {
    console.log(`> Fail on http://localhost:${port} Trying on ${port + 1}`);
    port++;
  }
  return port;
}

// function writeServerPort2Env() {
//   fs.readFileSync('../env', 'utf8', (err, data) => {
//     if (err) {
//       console.error(err);
//       return;
//     }
//     const result = data.replace(/NEXT_PORT=\d+/g, `NEXT_PORT=${defaultNextPort}`);
//     fs.writeFileSync('../env', result, 'utf8', (err) => {
//       if (err) console.error(err);
//     });
//   }
// }

// Prepare the renderer once the app is ready
app.on('ready', async () => {
  try {
    log.info('app ready');
    const nestServerPort = await getReachablePort(defaultNestServerPort);
    await bootstrap(nestServerPort);
    log.info('nest start');
    console.log(`> Ready on http://localhost:${nestServerPort}`);
    await nextApp.prepare();
    const port = await getReachablePort(defaultNextPort);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createServer((req: any, res: any) => {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    }).listen(port, () => {
      log.info('nextjs start');
      console.log(`> Ready on http://localhost:${port}`);
    });

    const mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,
        preload: join(__dirname, 'preload.js'),
      },
    });

    mainWindow.loadURL(`http://localhost:${port}/`);
  } catch (error) {
    log.error(error);
  }
});

// Quit the app once all windows are closed
app.on('window-all-closed', app.quit);

// listen the channel `message` and resend the received message to the renderer process
// eslint-disable-next-line @typescript-eslint/no-explicit-any
ipcMain.on('message', (event: IpcMainEvent, message: any) => {
  console.log(message);
  setTimeout(() => event.sender.send('message', 'hi from electron'), 500);
});
