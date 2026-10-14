export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface ILogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export const createLogger = (level: LogLevel, scope = 'ai'): ILogger => {
  const threshold = LEVELS[level];
  const log = (entryLevel: LogLevel, message: string, meta?: unknown) => {
    if (LEVELS[entryLevel] < threshold) {
      return;
    }
    const line = `${new Date().toISOString()} ${entryLevel.toUpperCase()} [${scope}] ${message}`;
    const target =
      entryLevel === 'error' ? console.error : entryLevel === 'warn' ? console.warn : console.log;
    if (meta === undefined) {
      target(line);
    } else {
      target(line, typeof meta === 'string' ? meta : JSON.stringify(meta));
    }
  };

  return {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
  };
};
