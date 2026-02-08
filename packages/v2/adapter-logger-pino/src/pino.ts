import pino, { type Logger, type LoggerOptions } from 'pino';

const resolveEnv = (key: string): string | undefined => {
  if (typeof process === 'undefined') {
    return undefined;
  }
  return process.env?.[key];
};

const defaultOptions: LoggerOptions = {
  name: 'teable-v2',
  level: resolveEnv('TEABLE_LOG_LEVEL') ?? resolveEnv('LOG_LEVEL') ?? 'info',
};

export const createV2PinoLogger = (options: LoggerOptions = {}): Logger =>
  pino({ ...defaultOptions, ...options });

export const v2PinoLogger = createV2PinoLogger();
