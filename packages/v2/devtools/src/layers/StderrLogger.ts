import {
  createContextualLogger,
  createLogScopeContext,
  type ILogger,
  type LogContext,
} from '@teable/v2-core';

/** Console-backed diagnostics sink for commands that reserve stdout for machine-readable output. */
export class StderrLogger implements ILogger {
  child(context: LogContext): ILogger {
    return createContextualLogger(this, context);
  }

  scope(scope: string, context?: LogContext): ILogger {
    return this.child(createLogScopeContext(scope, context ?? {}));
  }

  private write(message: string, context?: LogContext): void {
    if (context) {
      console.error(message, context);
      return;
    }
    console.error(message);
  }

  debug(message: string, context?: LogContext): void {
    this.write(message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write(message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write(message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write(message, context);
  }
}
