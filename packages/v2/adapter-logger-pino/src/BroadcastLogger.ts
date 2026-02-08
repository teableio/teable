import { createContextualLogger, createLogScopeContext } from '@teable/v2-core';
import type { ILogger, LogContext } from '@teable/v2-core';

export type ILogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ILogEntry {
  id: string;
  timestamp: string;
  level: ILogLevel;
  message: string;
  context?: LogContext;
}

export type ILogSubscriber = (entry: ILogEntry) => void;

const defaultBufferSize = 1000;

let entryIdCounter = 0;

const createEntryId = (): string => {
  entryIdCounter += 1;
  return `log-${Date.now()}-${entryIdCounter}`;
};

/**
 * A logger adapter that broadcasts log entries to subscribers while
 * forwarding all logs to a wrapped logger (e.g., pino).
 *
 * @example
 * ```typescript
 * const pino = createV2PinoLogger();
 * const broadcast = new BroadcastLogger(new PinoLoggerAdapter(pino));
 *
 * const unsubscribe = broadcast.subscribe((entry) => {
 *   console.log('New log:', entry);
 * });
 *
 * broadcast.info('Hello'); // logged to pino and broadcasted
 *
 * const history = broadcast.getHistory();
 * unsubscribe();
 * ```
 */
export class BroadcastLogger implements ILogger {
  private readonly subscribers = new Set<ILogSubscriber>();
  private readonly buffer: ILogEntry[] = [];
  private readonly bufferSize: number;
  private readonly baseContext: LogContext | undefined;

  constructor(
    private readonly delegate: ILogger,
    options?: { bufferSize?: number; context?: LogContext }
  ) {
    this.bufferSize = options?.bufferSize ?? defaultBufferSize;
    this.baseContext = options?.context;
  }

  /**
   * Subscribe to log entries. Returns an unsubscribe function.
   */
  subscribe(callback: ILogSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Get the buffered log history.
   */
  getHistory(): ReadonlyArray<ILogEntry> {
    return this.buffer;
  }

  /**
   * Clear the log buffer.
   */
  clearHistory(): void {
    this.buffer.length = 0;
  }

  /**
   * Get the number of active subscribers.
   */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  child(context: LogContext): ILogger {
    return createContextualLogger(this, context);
  }

  scope(scope: string, context?: LogContext): ILogger {
    return this.child(createLogScopeContext(scope, context ?? {}));
  }

  debug(message: string, context?: LogContext): void {
    this.delegate.debug(message, context);
    this.broadcast('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.delegate.info(message, context);
    this.broadcast('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.delegate.warn(message, context);
    this.broadcast('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.delegate.error(message, context);
    this.broadcast('error', message, context);
  }

  private broadcast(level: ILogLevel, message: string, context?: LogContext): void {
    const entry: ILogEntry = {
      id: createEntryId(),
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.baseContext ? { ...this.baseContext, ...context } : context,
    };

    // Add to buffer (ring buffer behavior)
    this.buffer.push(entry);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }

    // Notify subscribers
    for (const subscriber of this.subscribers) {
      try {
        subscriber(entry);
      } catch {
        // Ignore subscriber errors to prevent log failures
      }
    }
  }
}
