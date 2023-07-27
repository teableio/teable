const path = require('path');

export const startServer = async (mainWindow) => {
  if (process.env.ELECTRON_DEV === 'true') {
    return;
  }

  let p = path.join(process.resourcesPath, '/app/server/apps/nestjs-backend/dist/bootstrap.js');
  const backend = require(p);
  await backend.bootstrap();
  mainWindow.loadURL(`http://localhost:${process.env.PORT}/space`);
};
