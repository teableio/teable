import { createLogScopeContext, type ILogger, type LogContext } from '@teable/v2-core';
import type { PinoLogger } from 'nestjs-pino';

export class PinoLoggerAdapter implements ILogger {
  constructor(private readonly logger: PinoLogger) {}

  debug(message: string, context?: LogContext): void {
    if (context) {
      this.logger.debug(context, message);
      return;
    }
    this.logger.debug(message);
  }

  info(message: string, context?: LogContext): void {
    if (context) {
      this.logger.info(context, message);
      return;
    }
    this.logger.info(message);
  }

  warn(message: string, context?: LogContext): void {
    if (context) {
      this.logger.warn(context, message);
      return;
    }
    this.logger.warn(message);
  }

  error(message: string, context?: LogContext): void {
    if (context) {
      this.logger.error(context, message);
      return;
    }
    this.logger.error(message);
  }

  child(context: LogContext): ILogger {
    this.logger.logger.child(context);
    return this;
  }

  scope(scope: string, context?: LogContext): ILogger {
    return this.child(createLogScopeContext(scope, context ?? {}));
  }
}
