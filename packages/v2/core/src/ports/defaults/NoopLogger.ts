/* eslint-disable @typescript-eslint/no-empty-function */
import { createContextualLogger, createLogScopeContext } from '../Logger';
import type { ILogger, LogContext } from '../Logger';

export class NoopLogger implements ILogger {
  child(context: LogContext): ILogger {
    return createContextualLogger(this, context);
  }

  scope(scope: string, context?: LogContext): ILogger {
    return this.child(createLogScopeContext(scope, context ?? {}));
  }

  debug(_: string, __?: LogContext): void {}

  info(_: string, __?: LogContext): void {}

  warn(_: string, __?: LogContext): void {}

  error(_: string, __?: LogContext): void {}
}
