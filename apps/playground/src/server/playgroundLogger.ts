import { PinoLoggerAdapter, createV2PinoLogger } from '@teable/v2-adapter-logger-pino';
import type { LoggerOptions } from 'pino';

const isDev = process.env.NODE_ENV === 'development';

const prettyOptions: LoggerOptions = isDev
  ? {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    }
  : {};

export const playgroundPinoLogger = createV2PinoLogger(prettyOptions);
export const playgroundLogger = new PinoLoggerAdapter(playgroundPinoLogger);
