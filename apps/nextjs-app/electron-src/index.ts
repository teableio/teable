// Packages
import { join } from 'path';
import { bootstrap, getAvailablePort } from '@teable-group/backend';
import type { IpcMainEvent } from 'electron';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
// import isDev from 'electron-is-dev';
import log from 'electron-log';

let mainWindow: Electron.BrowserWindow;
log.info('app starting...');
const nextAppDir = app.getAppPath();
log.info('app path: ', nextAppDir);

// Prepare the renderer once the app is ready
app.on('ready', async () => {
  try {
    const port = await getAvailablePort(process.env.PORT || 3000);
    await bootstrap(port, nextAppDir);

    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
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

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'openFile'],
    filters: [
      {
        name: 'Teable/Markdown',
        extensions: ['teable', 'md', 'markdown', 'mdx'],
      },
    ],
  });
  return result.filePaths[0];
});
