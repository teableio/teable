import type { INestApplication } from '@nestjs/common';
import { bootstrap, getAvailablePort } from './bootstrap';

let nestApp: INestApplication | undefined;

(async () => {
  const port = await getAvailablePort(process.env.PORT || 3000);
  nestApp = await bootstrap(port, '../nextjs-app');
  process.env.PORT = String(port);
  console.log('node_env', process.env.PORT);
})();

export const app = nestApp;
