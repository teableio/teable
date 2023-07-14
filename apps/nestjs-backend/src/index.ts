import 'dayjs/plugin/timezone';
import 'dayjs/plugin/utc';
import type { INestApplication } from '@nestjs/common';
import { bootstrap } from './bootstrap';

let nestApp: INestApplication | undefined;

(async () => {
  nestApp = await bootstrap();
})();

export const app = nestApp;
