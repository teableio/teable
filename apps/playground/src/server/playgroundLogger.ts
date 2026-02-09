import {
  BroadcastLogger,
  PinoLoggerAdapter,
  createV2PinoLogger,
} from '@teable/v2-adapter-logger-pino';
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

// Use globalThis to ensure singleton across HMR in development
type GlobalWithLogger = typeof globalThis & {
  __playgroundPinoLogger?: ReturnType<typeof createV2PinoLogger>;
  __playgroundBroadcastLogger?: BroadcastLogger;
};

const globalScope = globalThis as GlobalWithLogger;

const ensurePinoLogger = () => {
  if (!globalScope.__playgroundPinoLogger) {
    globalScope.__playgroundPinoLogger = createV2PinoLogger(prettyOptions);
  }
  return globalScope.__playgroundPinoLogger;
};

const ensureBroadcastLogger = () => {
  if (!globalScope.__playgroundBroadcastLogger) {
    const pino = ensurePinoLogger();
    const pinoAdapter = new PinoLoggerAdapter(pino);
    globalScope.__playgroundBroadcastLogger = new BroadcastLogger(pinoAdapter, {
      bufferSize: 1000,
    });
  }
  return globalScope.__playgroundBroadcastLogger;
};

export const playgroundPinoLogger = ensurePinoLogger();

/**
 * Broadcast logger that wraps the pino adapter.
 * All logs are forwarded to pino while also being broadcast to subscribers.
 * Use `playgroundBroadcastLogger.subscribe()` to receive real-time log entries.
 */
export const playgroundBroadcastLogger = ensureBroadcastLogger();

/**
 * The main logger used throughout the playground.
 * This is the broadcast logger which delegates to pino.
 */
export const playgroundLogger = playgroundBroadcastLogger;
