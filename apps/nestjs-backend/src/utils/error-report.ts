/**
 * Error reporting without a paid monitoring service.
 *
 * This replaced the Sentry layer: the same `withScope`/`captureException`/
 * `captureMessage` shape, but everything is written to the application logger
 * (pino) with the collected tags, contexts, user and fingerprint, so a
 * self-hosted deployment keeps an auditable error trail.
 */
import { Logger } from '@nestjs/common';

const logger = new Logger('ErrorReport');

export type ReportLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

export class Scope {
  public level: ReportLevel = 'error';
  public readonly tags: Record<string, string> = {};
  public readonly contexts: Record<string, Record<string, unknown>> = {};
  public user: { id?: string; email?: string } | null = null;
  public fingerprint: string[] = [];

  setLevel(level: ReportLevel): void {
    this.level = level;
  }

  setTag(key: string, value: string): void {
    this.tags[key] = value;
  }

  setContext(name: string, data: Record<string, unknown>): void {
    this.contexts[name] = data;
  }

  setUser(user: { id?: string; email?: string } | null): void {
    this.user = user;
  }

  setFingerprint(fingerprint: string[]): void {
    this.fingerprint = fingerprint;
  }
}

let currentScope: Scope | undefined;

/**
 * Runs `callback` with a fresh reporting scope. Captures made inside the
 * callback carry the scope's tags/contexts; nested calls restore the outer
 * scope.
 */
export function withScope(callback: (scope: Scope) => void): void {
  const previous = currentScope;
  currentScope = new Scope();
  try {
    callback(currentScope);
  } finally {
    currentScope = previous;
  }
}

export function getCurrentScope(): Scope | undefined {
  return currentScope;
}

const describeError = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
};

const emit = (scope: Scope, payload: Record<string, unknown>, fallbackMessage: string): void => {
  const record = {
    ...payload,
    ...(Object.keys(scope.tags).length > 0 ? { tags: scope.tags } : {}),
    ...(Object.keys(scope.contexts).length > 0 ? { contexts: scope.contexts } : {}),
    ...(scope.user ? { user: scope.user } : {}),
    ...(scope.fingerprint.length > 0 ? { fingerprint: scope.fingerprint } : {}),
  };

  switch (scope.level) {
    case 'warning':
      logger.warn(record, fallbackMessage);
      break;
    case 'log':
    case 'info':
    case 'debug':
      logger.log(record, fallbackMessage);
      break;
    case 'fatal':
    case 'error':
    default:
      logger.error(record, fallbackMessage);
  }
};

export const captureException = (
  error: unknown,
  options?: { mechanism?: { handled: boolean; type: string } }
): void => {
  const scope = currentScope ?? new Scope();
  const { message, stack } = describeError(error);
  emit(
    scope,
    {
      error: message,
      ...(stack ? { stack } : {}),
      ...(options?.mechanism ? { mechanism: options.mechanism } : {}),
    },
    message
  );
};

export const captureMessage = (message: string, level?: ReportLevel): void => {
  const scope = currentScope ?? new Scope();
  if (level) {
    scope.setLevel(level);
  }
  emit(scope, {}, message);
};
