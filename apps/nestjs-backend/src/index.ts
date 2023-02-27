import type { INestApplication } from '@nestjs/common';
import { bootstrap, getAvailablePort } from './bootstrap';

let nestApp: INestApplication | undefined;

(async () => {
  const port = await getAvailablePort(process.env.PORT || 3000);
  nestApp = await bootstrap(port, '../nextjs-app');
})();

export const app = nestApp;
