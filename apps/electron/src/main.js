const { app, BrowserWindow } = require('electron');
const path = require('path');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const initEnv = () => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return;
  }
  process.env.NODE_ENV = 'production';
  process.env.SOCKET_PORT = 3000;
  process.env.PORT = 3000;
  process.env.NEXTJS_DIR = path.join(process.resourcesPath, '/app/server/apps/nextjs-app');
};

const startServer = async () => {
  let p = '';
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    p = path.join(process.cwd(), 'server/apps/nestjs-backend/dist/bootstrap.js');
  } else {
    p = path.join(process.resourcesPath, '/app/server/apps/nestjs-backend/dist/bootstrap.js');
  }

  const backend = require(p);
  await backend.bootstrap();
};

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      scrollBounce: true,
    },
  });

  // and load the index.html of the app.
  mainWindow.loadURL('http://localhost:3000/space');
  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  initEnv();
  await startServer();
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
