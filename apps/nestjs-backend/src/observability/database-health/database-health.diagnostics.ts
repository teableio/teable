import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import type { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type {
  DatabaseErrorClass,
  IDatabaseErrorClassification,
} from './database-error-classification';
import type { DatabaseHealthRole } from './database-instance';

/**
 * Bounded structured diagnostic events for database failures.
 *
 * What this is: ONE log record (`database_health:db_error`) per *accounted* failure the
 * span processor observes, carrying a correlation-ready payload — the counter metrics
 * answer "how often/badly", these records answer "for whom and where" without putting any
 * id, host, SQL text or parameter value into a metric label.
 *
 * What this is not: a ledger. Events are rate limited per (instanceId + errorClass) and
 * live only as long as log retention; suppressed occurrences are counted and reported on
 * the next emitted record, so a rate limit can never hide a sustained failure entirely.
 */
export const DATABASE_HEALTH_DB_ERROR_EVENT = 'database_health:db_error';

/** 60s window: the first occurrence always emits, then at most 4 more. */
export const DATABASE_HEALTH_WINDOW_MS = 60_000;
export const DATABASE_HEALTH_HOUR_MS = 3_600_000;
export const DATABASE_HEALTH_MAX_PER_WINDOW = 5;
export const DATABASE_HEALTH_MAX_PER_HOUR = 30;
/**
 * Windows are per endpoint + error class. A BYODB fleet churn could otherwise grow this
 * map without bound, so it is capped and LRU-evicted (eviction only forgets suppression
 * counters; it never hides an error class permanently).
 */
export const DATABASE_HEALTH_MAX_WINDOWS = 500;

export const DATABASE_ERROR_SUMMARY_LIMIT = 200;

export interface IDatabaseHealthCorrelation {
  spaceId?: string;
  baseId?: string;
  tableId?: string;
  taskId?: string;
  dataDbConnectionId?: string;
}

export interface IDatabaseHealthDiagnosticEvent {
  event: typeof DATABASE_HEALTH_DB_ERROR_EVENT;
  occurredAt: string;
  environment: string | undefined;
  instanceId: string;
  role: DatabaseHealthRole;
  operation: string;
  durationMs: number;
  errorClass: DatabaseErrorClass;
  retryable: boolean;
  redactedSummary: string | null;
  redactedSummaryReason?: string;
  fingerprint: string;
  traceId: string;
  spanId: string;
  spanName: string;
  correlation?: IDatabaseHealthCorrelation;
  sampling: { suppressedSinceLastEmit: number; emittedInWindow: number };
  pgCode?: string;
  driverCode?: string;
  /** Raw BYODB code (`data_db.*`): diagnostics only, never a metric label. */
  dataDbCode?: string;
}

export interface IDatabaseHealthErrorInput {
  instanceId: string;
  role: DatabaseHealthRole;
  operation: string;
  durationMs: number;
  classification: IDatabaseErrorClassification;
  /** Raw error text (span status message / span exception). Redacted before logging. */
  message?: string;
  traceId?: string;
  spanId?: string;
  spanName: string;
}

export interface IDatabaseHealthLogSink {
  log(event: string, payload: unknown): void;
}

export interface IDatabaseHealthDataDbContext {
  /** Opaque BYODB connection id; absent when the context is incomplete. */
  connectionId?: string;
}

export interface IDatabaseHealthDiagnosticsPort {
  /** The CLS data-database context, present only while serving a BYODB-bound request. */
  readDataDbContext(): IDatabaseHealthDataDbContext | undefined;
  emitDatabaseError(input: IDatabaseHealthErrorInput): IDatabaseHealthDiagnosticEvent | undefined;
}

/**
 * PostgreSQL error templates whose quoted token is always a schema identifier — a table,
 * column, constraint, role or database name from the server's own message text, never a
 * user value. `X` is bounded to PostgreSQL's 63-byte identifier limit.
 * Source of truth: docs/database-instance-evidence-contract.md §5 step 1.
 */
const IDENTIFIER_TEMPLATES: readonly RegExp[] = [
  /column\s+"[^"]{1,63}"(?:\s+of\s+relation\s+"[^"]{1,63}")?\s+does\s+not\s+exist/gi,
  /relation\s+"[^"]{1,63}"\s+does\s+not\s+exist/gi,
  /schema\s+"[^"]{1,63}"\s+does\s+not\s+exist/gi,
  /constraint\s+"[^"]{1,63}"(?:\s+of\s+relation\s+"[^"]{1,63}")?/gi,
  /duplicate\s+key\s+value\s+violates\s+unique\s+constraint\s+"[^"]{1,63}"/gi,
  /null\s+value\s+in\s+column\s+"[^"]{1,63}"/gi,
  /violates\s+foreign\s+key\s+constraint\s+"[^"]{1,63}"/gi,
  /permission\s+denied\s+for\s+(?:table|schema|relation|sequence|database)\s+"[^"]{1,63}"/gi,
  /password\s+authentication\s+failed\s+for\s+user\s+"[^"]{1,63}"/gi,
  /(?:role|database)\s+"[^"]{1,63}"/gi,
  /column\s+"[^"]{1,63}"\s+specified\s+more\s+than\s+once/gi,
];

const QUOTED_LITERAL = /"[^"]{1,63}"/g;
/** Quoted spans outside a template are values (parameters, record ids) and are removed. */
const ANY_QUOTED_SPAN = /"[^"]*"|'[^']*'/g;
const UUID_LITERAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_BLOB = /\b(?:0x)?[0-9a-f]{16,}\b/gi;
/** Outside quotes: a URL is an endpoint, and its userinfo is a credential. */
const URL_LITERAL = /\b(?:https?|ftps?|postgres(?:ql)?|rediss?):\/\/\S+/gi;
const EMAIL_LITERAL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** Word-bounded (never inside an identifier), signed, decimal-tolerant. */
const NUMBER_LITERAL = /(?<!\w)-?\d+(?:\.\d+)?\b/g;

const maskTemplateIdentifiers = (message: string, literals: string[]): string => {
  let masked = message;
  for (const template of IDENTIFIER_TEMPLATES) {
    masked = masked.replace(template, (match) =>
      match.replace(QUOTED_LITERAL, (literal) => {
        literals.push(literal);
        return `zzqprotected${literals.length - 1}zzq`;
      })
    );
  }
  return masked;
};

/**
 * Turns a raw database error message into a bounded, value-free summary, anchored on
 * PostgreSQL's own error templates (docs/database-instance-evidence-contract.md §5):
 *
 * 1. quoted identifiers inside a PG template stay verbatim — the server only puts schema
 *    names there, and they are what makes two occurrences of the same failure comparable;
 * 2. every other quoted span is a value and becomes `?`;
 * 3. outside quotes: numbers, UUIDs, ≥16-char hex blobs, URLs and e-mails become `?`;
 * 4. everything else is kept as written, so identifier-shaped tokens (`current transaction
 *    is aborted`) and driver markers (`(ENOTFOUND) tenant/user postgres.xyz not found`)
 *    survive;
 * 5. whitespace is collapsed and the result truncated to 200 characters.
 *
 * Returns null when the input has no usable text: the caller must then log the class alone
 * instead of falling back to the raw message. The collector normalizes `status_message`
 * with the same rules, so identical inputs must produce identical summaries and fingerprints.
 */
export const normalizeDatabaseErrorSummary = (message?: string): string | null => {
  if (!message?.trim()) {
    return null;
  }
  const templateIdentifiers: string[] = [];
  const masked = maskTemplateIdentifiers(message, templateIdentifiers)
    .replace(ANY_QUOTED_SPAN, '?')
    .replace(UUID_LITERAL, '?')
    .replace(HEX_BLOB, '?')
    .replace(URL_LITERAL, '?')
    .replace(EMAIL_LITERAL, '?')
    .replace(NUMBER_LITERAL, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(
      /zzqprotected(\d+)zzq/g,
      (_match, index: string) => templateIdentifiers[Number(index)] ?? '?'
    )
    .trim();
  return masked ? masked.slice(0, DATABASE_ERROR_SUMMARY_LIMIT) : null;
};

export const fingerprintDatabaseError = (
  instanceId: string,
  errorClass: DatabaseErrorClass,
  summary: string | null
): string =>
  `dbh_fp_${createHash('sha256')
    .update(`${instanceId}|${errorClass}|${summary ?? ''}`)
    .digest('hex')
    .slice(0, 24)}`;

const defaultLogSink: IDatabaseHealthLogSink = new Logger('DatabaseHealthDiagnostics');

interface IRateWindow {
  windowStart: number;
  windowCount: number;
  hourStart: number;
  hourCount: number;
  suppressed: number;
}

interface IWindowReservation {
  allowed: boolean;
  emittedInWindow: number;
  suppressedSinceLastEmit: number;
}

const readStoreField = (store: Record<string, unknown> | undefined, key: string) => {
  const value = store?.[key];
  return typeof value === 'string' && value ? value : undefined;
};

@Injectable()
export class DatabaseHealthDiagnostics implements IDatabaseHealthDiagnosticsPort {
  private readonly windows: LRUCache<string, IRateWindow>;
  private readonly now: () => number;
  private readonly logSink: IDatabaseHealthLogSink;
  private cls?: ClsService<IClsStore>;

  constructor(
    private readonly options: {
      /** Test seam; defaults to Date.now. */
      now?: () => number;
      maxWindowKeys?: number;
      logSink?: IDatabaseHealthLogSink;
    } = {}
  ) {
    this.windows = new LRUCache<string, IRateWindow>({
      max: options.maxWindowKeys ?? DATABASE_HEALTH_MAX_WINDOWS,
    });
    this.now = options.now ?? Date.now;
    this.logSink = options.logSink ?? defaultLogSink;
  }

  /**
   * Optional: without CLS the emitter still works, it just reports no correlation ids
   * (background tasks, workers, and unit tests have no request context).
   */
  bindClsService(cls?: ClsService<IClsStore>): void {
    this.cls = cls;
  }

  readDataDbContext(): IDatabaseHealthDataDbContext | undefined {
    const dataDb = this.readFromCls((cls) => cls.get('dataDb'));
    if (!dataDb) {
      return undefined;
    }
    const { connectionId } = dataDb;
    return typeof connectionId === 'string' && connectionId ? { connectionId } : {};
  }

  readDataDbConnectionId(): string | undefined {
    return this.readDataDbContext()?.connectionId;
  }

  emitDatabaseError(input: IDatabaseHealthErrorInput): IDatabaseHealthDiagnosticEvent | undefined {
    try {
      const now = this.now();
      const reservation = this.reserveWindow(
        `${input.instanceId}|${input.classification.errorClass}`,
        now
      );
      if (!reservation.allowed) {
        return undefined;
      }

      const summary = normalizeDatabaseErrorSummary(input.message);
      const correlation = this.readCorrelation();
      const { classification } = input;
      const event: IDatabaseHealthDiagnosticEvent = {
        event: DATABASE_HEALTH_DB_ERROR_EVENT,
        occurredAt: new Date(now).toISOString(),
        environment: process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV,
        instanceId: input.instanceId,
        role: input.role,
        operation: input.operation,
        durationMs: input.durationMs,
        errorClass: classification.errorClass,
        retryable: classification.retryable,
        redactedSummary: summary,
        // A redaction that lost everything is reported as such: the raw message must
        // never be logged just because the normalised form came out empty.
        ...(summary === null ? { redactedSummaryReason: 'no_redactable_error_text' } : {}),
        fingerprint: fingerprintDatabaseError(input.instanceId, classification.errorClass, summary),
        traceId: input.traceId ?? '',
        spanId: input.spanId ?? '',
        spanName: input.spanName,
        sampling: {
          suppressedSinceLastEmit: reservation.suppressedSinceLastEmit,
          emittedInWindow: reservation.emittedInWindow,
        },
        ...(correlation ? { correlation } : {}),
        ...(classification.pgCode ? { pgCode: classification.pgCode } : {}),
        ...(classification.driverCode ? { driverCode: classification.driverCode } : {}),
        ...(classification.dataDbCode ? { dataDbCode: classification.dataDbCode } : {}),
      };
      this.logSink.log(DATABASE_HEALTH_DB_ERROR_EVENT, event);
      return event;
    } catch {
      // A monitoring path never breaks the request that produced the failure.
      return undefined;
    }
  }

  private reserveWindow(key: string, now: number): IWindowReservation {
    const tracked = this.windows.get(key);
    const window: IRateWindow = tracked
      ? { ...tracked }
      : { windowStart: now, windowCount: 0, hourStart: now, hourCount: 0, suppressed: 0 };

    if (now - window.windowStart >= DATABASE_HEALTH_WINDOW_MS) {
      window.windowStart = now;
      window.windowCount = 0;
    }
    if (now - window.hourStart >= DATABASE_HEALTH_HOUR_MS) {
      window.hourStart = now;
      window.hourCount = 0;
    }

    // The hourly cap also bounds the first occurrence of each window: otherwise a failing
    // instance could emit 60 records an hour and the cap would mean nothing.
    const allowed =
      window.hourCount < DATABASE_HEALTH_MAX_PER_HOUR &&
      (window.windowCount === 0 || window.windowCount < DATABASE_HEALTH_MAX_PER_WINDOW);

    if (!allowed) {
      window.suppressed += 1;
      this.windows.set(key, window);
      return { allowed: false, emittedInWindow: 0, suppressedSinceLastEmit: 0 };
    }

    const suppressedSinceLastEmit = window.suppressed;
    window.windowCount += 1;
    window.hourCount += 1;
    window.suppressed = 0;
    this.windows.set(key, window);
    return { allowed: true, emittedInWindow: window.windowCount, suppressedSinceLastEmit };
  }

  private readCorrelation(): IDatabaseHealthCorrelation | undefined {
    const correlation: IDatabaseHealthCorrelation = {};
    const spaceId = this.readFromCls((cls) => cls.get('spaceId'));
    if (spaceId) {
      correlation.spaceId = spaceId;
    }
    const unlisted = this.readUnlistedClsFields();
    if (unlisted.baseId) {
      correlation.baseId = unlisted.baseId;
    }
    if (unlisted.tableId) {
      correlation.tableId = unlisted.tableId;
    }
    if (unlisted.taskId) {
      correlation.taskId = unlisted.taskId;
    }
    const dataDbConnectionId = this.readDataDbConnectionId();
    if (dataDbConnectionId) {
      correlation.dataDbConnectionId = dataDbConnectionId;
    }
    return Object.keys(correlation).length > 0 ? correlation : undefined;
  }

  /**
   * `baseId`/`tableId`/`taskId` are not part of `IClsStore`; they are read from the
   * untyped store bag and each one still has to pass a typeof check. The double cast is
   * deliberate: `ClsStore` is an untyped bag at runtime, and widening the value type to
   * `unknown` forces every read below to be narrowed.
   */
  private readUnlistedClsFields(): Record<string, string | undefined> {
    const store = this.readFromCls(
      (cls) => cls.get() as unknown as Record<string, unknown> | undefined
    );
    return {
      baseId: readStoreField(store, 'baseId'),
      tableId: readStoreField(store, 'tableId'),
      taskId: readStoreField(store, 'taskId'),
    };
  }

  private readFromCls<T>(read: (cls: ClsService<IClsStore>) => T): T | undefined {
    try {
      return this.cls ? read(this.cls) : undefined;
    } catch {
      return undefined;
    }
  }
}

/** Process-wide emitter shared by the span processor and the Nest module. */
export const databaseHealthDiagnostics = new DatabaseHealthDiagnostics();
