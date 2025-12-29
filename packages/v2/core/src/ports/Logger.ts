export type LogContext = Readonly<Record<string, unknown>>;
export type LogScopes = Readonly<Record<string, LogContext>>;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const extractScopes = (context?: LogContext): LogScopes | undefined => {
  if (!context) return undefined;
  const scopes = (context as { scopes?: unknown }).scopes;
  if (!isRecord(scopes)) return undefined;
  return scopes as LogScopes;
};

const mergeScopes = (base?: LogScopes, next?: LogScopes): LogScopes | undefined => {
  if (!base) return next;
  if (!next) return base;
  return { ...base, ...next };
};

const mergeLogContext = (base?: LogContext, next?: LogContext): LogContext | undefined => {
  if (!base) return next;
  if (!next) return base;
  const mergedScopes = mergeScopes(extractScopes(base), extractScopes(next));
  const merged: Record<string, unknown> = { ...base, ...next };
  if (mergedScopes) {
    merged.scopes = mergedScopes;
  }
  return merged;
};

export interface ILogger {
  child(context: LogContext): ILogger;
  scope(scope: string, context?: LogContext): ILogger;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export const createLogScopeContext = (scope: string, context: LogContext = {}): LogContext => {
  return {
    scopes: {
      [scope]: context,
    },
  };
};

export const createContextualLogger = (logger: ILogger, context: LogContext): ILogger => {
  return new ContextualLogger(logger, context);
};

class ContextualLogger implements ILogger {
  constructor(
    private readonly logger: ILogger,
    private readonly baseContext: LogContext
  ) {}

  child(context: LogContext): ILogger {
    const merged = mergeLogContext(this.baseContext, context);
    return new ContextualLogger(this.logger, merged ?? context);
  }

  scope(scope: string, context?: LogContext): ILogger {
    return this.child(createLogScopeContext(scope, context ?? {}));
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, mergeLogContext(this.baseContext, context));
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(message, mergeLogContext(this.baseContext, context));
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, mergeLogContext(this.baseContext, context));
  }

  error(message: string, context?: LogContext): void {
    this.logger.error(message, mergeLogContext(this.baseContext, context));
  }
}
