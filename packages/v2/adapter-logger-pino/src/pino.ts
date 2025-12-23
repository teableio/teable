import pino, { type Logger, type LoggerOptions } from 'pino';

const defaultOptions: LoggerOptions = {
  name: 'teable-v2',
  level: process.env.TEABLE_LOG_LEVEL ?? process.env.LOG_LEVEL ?? 'info',
};

export const createV2PinoLogger = (options: LoggerOptions = {}): Logger =>
  pino({ ...defaultOptions, ...options });

export const v2PinoLogger = createV2PinoLogger();
