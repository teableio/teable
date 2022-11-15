// Packages
import { join } from 'path';
import type { IpcMainEvent } from 'electron';
import { app, BrowserWindow, ipcMain } from 'electron';
import isDev from 'electron-is-dev';
import log from 'electron-log';
import { startServer } from './server';

log.info('log is fine');
const nextAppDir = app.getAppPath();

// Prepare the renderer once the app is ready
app.on('ready', async () => {
  try {
    await startServer({
      isDev,
      nextAppDir,
      log,
      callback: (serverPort) => {
        const mainWindow = new BrowserWindow({
          width: 800,
          height: 600,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: false,
            preload: join(__dirname, 'preload.js'),
          },
        });

        mainWindow.loadURL(`http://localhost:${serverPort}/`);
      },
    });
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
