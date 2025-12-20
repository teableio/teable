/* eslint-disable @typescript-eslint/no-empty-function */
import type { ILogger, LogContext } from '../Logger';

export class NoopLogger implements ILogger {
  debug(_: string, __?: LogContext): void {}

  info(_: string, __?: LogContext): void {}

  warn(_: string, __?: LogContext): void {}

  error(_: string, __?: LogContext): void {}
}
