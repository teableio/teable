/* eslint-disable @typescript-eslint/naming-convention */
import { createContextualLogger, createLogScopeContext } from '@teable/v2-core';
import type { ILogger, LogContext } from '@teable/v2-core';

type ConsoleLogFn = (...args: unknown[]) => void;

export class ConsoleLogger implements ILogger {
  child(context: LogContext): ILogger {
    return createContextualLogger(this, context);
  }

  scope(scope: string, context?: LogContext): ILogger {
    return this.child(createLogScopeContext(scope, context ?? {}));
  }

  private log(logFn: ConsoleLogFn, message: string, context?: LogContext): void {
    if (context) {
      logFn.call(console, message, context);
      return;
    }
    logFn.call(console, message);
  }

  debug(message: string, context?: LogContext): void {
    this.log(console.debug, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log(console.info, message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log(console.warn, message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log(console.error, message, context);
  }
}
