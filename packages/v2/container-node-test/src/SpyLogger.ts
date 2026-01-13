import type { ILogger, LogContext } from '@teable/v2-core';

/**
 * A captured log entry from SpyLogger.
 */
export interface CapturedLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: LogContext;
  timestamp: number;
}

/**
 * The context logged by ComputedFieldUpdater.execute() for computed:plan.
 * @see ComputedFieldUpdater.ts:169-191
 */
export interface ComputedPlanLogEntry {
  baseId: string;
  seedTableId: string;
  changeType?: 'insert' | 'update' | 'delete';
  seedRecordIds: string[];
  steps: Array<{
    tableId: string;
    level: number;
    fieldIds: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    linkFieldId?: string;
    order: number;
  }>;
  sameTableBatches: Array<{
    tableId: string;
    stepCount: number;
    minLevel: number;
    maxLevel: number;
    fieldCount: number;
  }>;
}

/**
 * A logger that captures all log entries for testing purposes.
 * Optionally forwards logs to a delegate logger (e.g., ConsoleLogger).
 */
export class SpyLogger implements ILogger {
  private readonly entries: CapturedLogEntry[] = [];
  private readonly delegate?: ILogger;

  constructor(delegate?: ILogger) {
    this.delegate = delegate;
  }

  child(context: LogContext): ILogger {
    return new ChildSpyLogger(this, context, this.delegate?.child(context));
  }

  scope(scope: string, context?: LogContext): ILogger {
    return this.child({ scopes: { [scope]: context ?? {} } });
  }

  capture(level: CapturedLogEntry['level'], message: string, context?: LogContext): void {
    this.entries.push({ level, message, context, timestamp: Date.now() });
  }

  debug(message: string, context?: LogContext): void {
    this.capture('debug', message, context);
    this.delegate?.debug(message, context);
  }

  info(message: string, context?: LogContext): void {
    this.capture('info', message, context);
    this.delegate?.info(message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.capture('warn', message, context);
    this.delegate?.warn(message, context);
  }

  error(message: string, context?: LogContext): void {
    this.capture('error', message, context);
    this.delegate?.error(message, context);
  }

  /**
   * Get all captured log entries.
   */
  getEntries(): ReadonlyArray<CapturedLogEntry> {
    return this.entries;
  }

  /**
   * Get entries filtered by message pattern.
   */
  getEntriesByMessage(pattern: string | RegExp): CapturedLogEntry[] {
    return this.entries.filter((e) =>
      typeof pattern === 'string' ? e.message.includes(pattern) : pattern.test(e.message)
    );
  }

  /**
   * Get all computed:plan log entries.
   * These are logged by ComputedFieldUpdater during execution.
   */
  getComputedPlans(): ComputedPlanLogEntry[] {
    return this.entries
      .filter((e) => e.message === 'computed:plan')
      .map((e) => e.context as unknown as ComputedPlanLogEntry);
  }

  /**
   * Get the most recent computed:plan log entry.
   */
  getLastComputedPlan(): ComputedPlanLogEntry | undefined {
    const plans = this.getComputedPlans();
    return plans[plans.length - 1];
  }

  /**
   * Clear all captured entries.
   */
  clear(): void {
    this.entries.length = 0;
  }
}

/**
 * Child logger that maintains context and forwards captures to parent SpyLogger.
 */
class ChildSpyLogger implements ILogger {
  constructor(
    private readonly parent: SpyLogger,
    private readonly baseContext: LogContext,
    private readonly delegate?: ILogger
  ) {}

  child(context: LogContext): ILogger {
    return new ChildSpyLogger(
      this.parent,
      { ...this.baseContext, ...context },
      this.delegate?.child(context)
    );
  }

  scope(scope: string, context?: LogContext): ILogger {
    return this.child({ scopes: { [scope]: context ?? {} } });
  }

  debug(message: string, context?: LogContext): void {
    this.parent.capture('debug', message, { ...this.baseContext, ...context });
    this.delegate?.debug(message, context);
  }

  info(message: string, context?: LogContext): void {
    this.parent.capture('info', message, { ...this.baseContext, ...context });
    this.delegate?.info(message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.parent.capture('warn', message, { ...this.baseContext, ...context });
    this.delegate?.warn(message, context);
  }

  error(message: string, context?: LogContext): void {
    this.parent.capture('error', message, { ...this.baseContext, ...context });
    this.delegate?.error(message, context);
  }
}
