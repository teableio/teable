import { getAvailablePort } from './utils';
const path = require('path');

export const initEnv = async () => {
  const defaultPort = 3000;

  process.env.ELECTRON_DEV = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);

  if (process.env.ELECTRON_DEV === 'true') {
    process.env.PORT = defaultPort;
    return;
  }
  const port = await getAvailablePort(defaultPort);
  process.env.STATIC_PATH = path.join(__dirname, '../..', 'static');
  process.env.NODE_ENV = 'production';
  process.env.SOCKET_PORT = port;
  process.env.PORT = port;
  process.env.NEXTJS_DIR = path.join(process.resourcesPath, '/app/server/apps/nextjs-app');
  process.env.I18N_LOCALES_PATH = path.join(
    process.resourcesPath,
    '/app/server/packages/common-i18n/src/locales'
  );
};
