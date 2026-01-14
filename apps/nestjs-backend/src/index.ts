import './instrument';
import './tracing';
import type { INestApplication } from '@nestjs/common';
import { bootstrap } from './bootstrap';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const module: any;

let app: INestApplication | undefined;

async function main() {
  app = await bootstrap();
}

main();

if (module.hot) {
  module.hot.accept((err: Error) => {
    if (err) {
      console.error('[HMR] Update failed, restarting...', err);
      // If HMR fails, restart the app
      main();
    }
  });
  module.hot.dispose(() => {
    app?.close();
  });
}

export { app };
