import { Injectable, Logger } from '@nestjs/common';
import type { Attributes, Context, Counter, Histogram, Span } from '@opentelemetry/api';
import { SpanStatusCode, metrics } from '@opentelemetry/api';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { IPgPoolSnapshot, PgPoolFailurePhase, PgPoolObserver } from '@teable/db-main-prisma';
import { classifyDataDbRuntimeError } from '../../global/data-db-runtime-error';
import { resolveTeableDbTraceContext } from '../../tracing-db-context';
import {
  classifyDatabaseError,
  extractSpanErrorCode,
  type IDatabaseErrorClassification,
} from './database-error-classification';
import {
  databaseHealthDiagnostics,
  type IDatabaseHealthDiagnosticsPort,
} from './database-health.diagnostics';
import {
  resolveDatabaseInstanceFromSpanAttributes,
  resolveDatabaseInstanceId,
  UNKNOWN_DATABASE_ROLE,
  type DatabaseHealthRole,
} from './database-instance';

/**
 * Per-database-instance health instrumentation (folder architecture notes).
 *
 * 1. Full fidelity vs sampled. Every number this module produces comes from a metric
 *    instrument, and the span-driven ones are recorded from *span processor* callbacks.
 *    tracing.ts samples at 100% (`AlwaysOnSampler`) and the ~10% export ratio only decides
 *    what leaves the process as a *trace*. So counters and histograms here are complete,
 *    while an exported trace is not: never derive a call count, a success rate or a latency
 *    percentile from exported traces — error *attribution* is what traces add.
 *
 * 2. Double-count rule for `prisma:*`. Prisma runs through the same process-owned pg pool,
 *    so instrumentation-pg already reports each statement as `pg.query:*`, and Prisma
 *    reports the same work again as `prisma:engine:db_query` / `prisma:client:operation`.
 *    The span processor therefore skips every `prisma:*` span *before* it looks at
 *    `db.system`, so a statement is counted once and one SQL statement cannot inflate both
 *    the counter and the histogram.
 *
 * 3. Acquire vs connect. Two different events, two different observation points:
 *    - `pg-pool.connect` spans own the acquire series: `pool.acquire.duration` (waiting for
 *      a client plus the attempt) and, for rejected attempts, `pool.acquire.timeouts` and
 *      `connection.failures{failure.phase="acquire"}`. Instrumentation-pg creates that span
 *      for every attempt, so the series is complete.
 *    - The pool observer owns what no span carries: `connection.established` (the pg Pool
 *      `'connect'` event is a real physical connection, not a checkout) and
 *      `connection.failures{failure.phase="idle"}` (the `'error'` event = an established
 *      idle client died). A rejected *physical* attempt has no other reporter, so it is
 *      recorded as `failure.phase="connect"`; `failure.phase` is what tells the producers
 *      apart, so aggregate one phase at a time instead of summing a phase-blind total.
 *
 * 4. Aggregation. The same instance+pool is reported by every replica that owns it: sum
 *    counters and gauges across replicas (each replica's instrument carries its pod's
 *    resource identity, which keeps cumulative series from merging). Never average
 *    percentiles: merge the histogram buckets of the replicas, then read the quantile off
 *    the merged buckets. The bucket boundaries below are the collector's contract.
 *
 * 5. Bounded diagnostic events. Failures additionally produce at most a handful of
 *    `database_health:db_error` log records (see database-health.diagnostics.ts): the first
 *    occurrence per minute window, then a small quota per minute and per hour, with the
 *    suppressed count reported on the next emitted record. Counters stay the complete
 *    signal — the event stream is sampled by design and must never be used as a denominator.
 */
export const DATABASE_HEALTH_METER_NAME = 'teable-observability';

export const DATABASE_HEALTH_METRIC = {
  operations: 'teable.database.client.operations',
  operationDuration: 'teable.database.client.operation.duration',
  acquireDuration: 'teable.database.client.pool.acquire.duration',
  acquireTimeouts: 'teable.database.client.pool.acquire.timeouts',
  connectionsEstablished: 'teable.database.client.connection.established',
  connectionFailures: 'teable.database.client.connection.failures',
} as const;

export const DATABASE_HEALTH_ATTRIBUTE = {
  instanceId: 'teable.database.instance.id',
  role: 'teable.database.role',
  /** Opaque BYODB connection id: several projects can share one pooler endpoint. */
  connectionId: 'teable.database.connection.id',
  operation: 'db.operation.name',
  outcome: 'outcome',
  errorClass: 'teable.database.error.class',
  poolName: 'teable.database.pool.name',
  failurePhase: 'teable.database.failure.phase',
} as const;

/** Milliseconds. Shared with the external collector's histogram merge contract. */
export const DATABASE_LATENCY_BUCKETS_MS = [1, 5, 25, 100, 500, 2000, 10000];

export type DatabaseHealthOutcome = 'success' | 'error';
export type DatabaseOperation =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'WITH'
  | 'BEGIN'
  | 'COMMIT'
  | 'ROLLBACK'
  | 'OTHER';

const OPERATION_BY_TOKEN: Record<string, DatabaseOperation> = {
  SELECT: 'SELECT',
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  WITH: 'WITH',
  BEGIN: 'BEGIN',
  COMMIT: 'COMMIT',
  ROLLBACK: 'ROLLBACK',
  OTHER: 'OTHER',
};

export const PG_QUERY_SPAN_PREFIX = 'pg.query';
export const PG_POOL_CONNECT_SPAN_NAME = 'pg-pool.connect';
export const PG_POOL_CONNECT_OPERATION = 'acquire';

interface IDatabaseHealthInstruments {
  operations: Counter;
  operationDuration: Histogram;
  acquireDuration: Histogram;
  acquireTimeouts: Counter;
  connectionsEstablished: Counter;
  connectionFailures: Counter;
}

interface IObservedError {
  code?: string;
  message?: string;
}

interface IObservedTrace {
  traceId: string;
  spanId: string;
  spanName: string;
}

export interface IDatabaseHealthQueryObservation {
  instanceId: string;
  role: DatabaseHealthRole;
  operation: DatabaseOperation;
  durationMs: number;
  connectionId?: string;
  error?: IObservedError;
  trace: IObservedTrace;
}

export interface IDatabaseHealthAcquireObservation {
  instanceId: string;
  role: DatabaseHealthRole;
  poolName: string;
  durationMs: number;
  connectionId?: string;
  error?: IObservedError;
  trace: IObservedTrace;
}

const readStringAttribute = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const readSpanDurationMs = (span: ReadableSpan): number => {
  const duration = span.duration;
  if (!Array.isArray(duration)) {
    return 0;
  }
  const [seconds, nanos] = duration;
  return (seconds ?? 0) * 1000 + (nanos ?? 0) / 1e6;
};

const readSpanOperation = (spanName: string, attributes: Attributes): DatabaseOperation => {
  // instrumentation-pg names the span `pg.query:<OP> <database>`; the operation token is
  // either the parsed SQL command or a prepared-statement name.
  const suffix =
    spanName === PG_QUERY_SPAN_PREFIX ? '' : spanName.slice(PG_QUERY_SPAN_PREFIX.length + 1);
  const candidates = [suffix.split(' ')[0], readStringAttribute(attributes['db.operation.name'])];
  for (const candidate of candidates) {
    const operation = candidate && OPERATION_BY_TOKEN[candidate.trim().toUpperCase()];
    if (operation) {
      return operation;
    }
  }
  return 'OTHER';
};

const readSpanRole = (attributes: Attributes): DatabaseHealthRole => {
  const role = readStringAttribute(attributes['teable.db.role']);
  return role === 'meta' || role === 'data' ? role : UNKNOWN_DATABASE_ROLE;
};

const readQueriedConnectionId = (attributes: Attributes): { connectionId?: string } => {
  const connectionId = readStringAttribute(attributes['teable.data_db.connection_id']);
  return connectionId ? { connectionId } : {};
};

@Injectable()
export class DatabaseHealthMetricsService implements PgPoolObserver {
  private instruments?: IDatabaseHealthInstruments;

  constructor(
    private readonly diagnostics: IDatabaseHealthDiagnosticsPort = databaseHealthDiagnostics
  ) {}

  /**
   * Created on first use, never at construction: the process-wide instance is imported by
   * `tracing.ts` *before* the SDK registers the global meter provider, and
   * `@opentelemetry/api` resolves the provider when `getMeter()` is called — an instrument
   * created before registration stays a no-op forever.
   */
  private get instrument(): IDatabaseHealthInstruments {
    this.instruments ??= this.createInstruments();
    return this.instruments;
  }

  recordQuery(observation: IDatabaseHealthQueryObservation): void {
    // The connection id is attribution, not error handling: it must be on success too, so
    // several projects sharing one pooler endpoint stay separable.
    const connectionId = this.resolveConnectionId(observation.connectionId);
    const classification = this.classificationFor(observation.error, observation.connectionId);
    const attributes: Attributes = {
      [DATABASE_HEALTH_ATTRIBUTE.instanceId]: observation.instanceId,
      [DATABASE_HEALTH_ATTRIBUTE.role]: observation.role,
      [DATABASE_HEALTH_ATTRIBUTE.operation]: observation.operation,
      ...(connectionId ? { [DATABASE_HEALTH_ATTRIBUTE.connectionId]: connectionId } : {}),
    };
    const outcome: DatabaseHealthOutcome = observation.error ? 'error' : 'success';
    this.instrument.operations.add(1, {
      ...attributes,
      [DATABASE_HEALTH_ATTRIBUTE.outcome]: outcome,
      ...(classification
        ? { [DATABASE_HEALTH_ATTRIBUTE.errorClass]: classification.errorClass }
        : {}),
    });
    this.instrument.operationDuration.record(observation.durationMs, attributes);
    if (classification) {
      this.reportFailure({
        attributes: observation,
        classification,
        error: observation.error,
      });
    }
  }

  recordAcquire(observation: IDatabaseHealthAcquireObservation): void {
    const attributes: Attributes = {
      [DATABASE_HEALTH_ATTRIBUTE.instanceId]: observation.instanceId,
      [DATABASE_HEALTH_ATTRIBUTE.role]: observation.role,
      [DATABASE_HEALTH_ATTRIBUTE.poolName]: observation.poolName,
    };
    const outcome: DatabaseHealthOutcome = observation.error ? 'error' : 'success';
    this.instrument.acquireDuration.record(observation.durationMs, {
      ...attributes,
      [DATABASE_HEALTH_ATTRIBUTE.outcome]: outcome,
    });
    const classification = this.classificationFor(observation.error, observation.connectionId);
    if (!classification) {
      return;
    }
    const connectionId = this.resolveConnectionId(observation.connectionId);
    if (
      classification.errorClass === 'timeout' ||
      classification.errorClass === 'connection_timeout'
    ) {
      this.instrument.acquireTimeouts.add(1, {
        [DATABASE_HEALTH_ATTRIBUTE.instanceId]: observation.instanceId,
        [DATABASE_HEALTH_ATTRIBUTE.role]: observation.role,
      });
    }
    this.instrument.connectionFailures.add(1, {
      [DATABASE_HEALTH_ATTRIBUTE.instanceId]: observation.instanceId,
      [DATABASE_HEALTH_ATTRIBUTE.role]: observation.role,
      [DATABASE_HEALTH_ATTRIBUTE.errorClass]: classification.errorClass,
      [DATABASE_HEALTH_ATTRIBUTE.failurePhase]: 'acquire',
      ...(connectionId ? { [DATABASE_HEALTH_ATTRIBUTE.connectionId]: connectionId } : {}),
    });
    this.reportFailure({
      attributes: {
        instanceId: observation.instanceId,
        role: observation.role,
        operation: PG_POOL_CONNECT_OPERATION,
        durationMs: observation.durationMs,
        trace: observation.trace,
      },
      classification,
      error: observation.error,
    });
  }

  onPoolCreated(_snapshot: IPgPoolSnapshot): void {
    // Pool creation state is already exported by the `teable.database.client.pool.*`
    // observable gauges (DatabaseClientPoolMetrics); nothing to add here.
  }

  onConnectEstablished(snapshot: IPgPoolSnapshot): void {
    this.instrument.connectionsEstablished.add(1, this.poolAttributes(snapshot));
  }

  onPoolError(snapshot: IPgPoolSnapshot, error: unknown): void {
    const classification = this.classificationFor(error);
    if (!classification) {
      return;
    }
    const connectionId = this.resolveConnectionId();
    this.instrument.connectionFailures.add(1, {
      ...this.poolAttributes(snapshot),
      [DATABASE_HEALTH_ATTRIBUTE.errorClass]: classification.errorClass,
      // An established client died while idle: the pool removes it.
      [DATABASE_HEALTH_ATTRIBUTE.failurePhase]: 'idle',
      ...(connectionId ? { [DATABASE_HEALTH_ATTRIBUTE.connectionId]: connectionId } : {}),
    });
  }

  onAcquireFailure(
    snapshot: IPgPoolSnapshot,
    error: unknown,
    phase: PgPoolFailurePhase,
    _durationMs: number
  ): void {
    // Phase is what keeps the two acquire observation points apart: the pooled
    // `pg-pool.connect` span reports `acquire` (it exists for every attempt), the pool
    // wrapper reports the physical `connect` failure mode (`acquire` here would duplicate
    // the span). See the module header.
    if (phase !== 'connect') {
      return;
    }
    const classification = this.classificationFor(error);
    if (!classification) {
      return;
    }
    const connectionId = this.resolveConnectionId();
    this.instrument.connectionFailures.add(1, {
      ...this.poolAttributes(snapshot),
      [DATABASE_HEALTH_ATTRIBUTE.errorClass]: classification.errorClass,
      [DATABASE_HEALTH_ATTRIBUTE.failurePhase]: 'connect',
      ...(connectionId ? { [DATABASE_HEALTH_ATTRIBUTE.connectionId]: connectionId } : {}),
    });
  }

  onAcquireSettled(
    _snapshot: IPgPoolSnapshot,
    _phase: PgPoolFailurePhase,
    _durationMs: number,
    _isError: boolean
  ): void {
    // Settled attempts (callback and promise style, including Prisma's retry as its own
    // attempt) are visible to consumers of the seam; the acquire histogram is recorded from
    // `pg-pool.connect` spans so every acquisition has exactly one histogram producer.
  }

  private createInstruments(): IDatabaseHealthInstruments {
    const meter = metrics.getMeter(DATABASE_HEALTH_METER_NAME);
    return {
      operations: meter.createCounter(DATABASE_HEALTH_METRIC.operations, {
        description: 'Completed PostgreSQL operations by database instance, operation and outcome',
        unit: '1',
      }),
      operationDuration: meter.createHistogram(DATABASE_HEALTH_METRIC.operationDuration, {
        description: 'PostgreSQL operation duration by database instance, from query start to end',
        unit: 'ms',
        advice: { explicitBucketBoundaries: DATABASE_LATENCY_BUCKETS_MS },
      }),
      acquireDuration: meter.createHistogram(DATABASE_HEALTH_METRIC.acquireDuration, {
        description: 'Pool acquisition latency until a client is handed out or the attempt fails',
        unit: 'ms',
        advice: { explicitBucketBoundaries: DATABASE_LATENCY_BUCKETS_MS },
      }),
      acquireTimeouts: meter.createCounter(DATABASE_HEALTH_METRIC.acquireTimeouts, {
        description: 'Pool acquisitions that failed with a connection or pool timeout',
        unit: '1',
      }),
      connectionsEstablished: meter.createCounter(DATABASE_HEALTH_METRIC.connectionsEstablished, {
        description: 'Physical PostgreSQL connections really established, not pool checkouts',
        unit: '1',
      }),
      connectionFailures: meter.createCounter(DATABASE_HEALTH_METRIC.connectionFailures, {
        description: 'Database connection and acquisition failures by failure phase',
        unit: '1',
      }),
    };
  }

  private poolAttributes(snapshot: IPgPoolSnapshot): Attributes {
    return {
      [DATABASE_HEALTH_ATTRIBUTE.instanceId]: resolveDatabaseInstanceId({
        host: snapshot.host,
        port: snapshot.port,
      }),
      // Pool events carry no span, so the role comes from the same configured-URL
      // resolution the span instrumentation uses (meta match, otherwise data).
      [DATABASE_HEALTH_ATTRIBUTE.role]: resolveTeableDbTraceContext({
        database: snapshot.database,
        host: snapshot.host,
        port: snapshot.port,
      }).role,
      [DATABASE_HEALTH_ATTRIBUTE.poolName]: snapshot.poolName ?? 'shared',
    };
  }

  /**
   * The opaque BYODB connection id: taken from the span when present, otherwise from the
   * CLS data-database context. Omitted entirely (never an empty label) when neither exists,
   * which is the normal case for platform-database traffic and background work.
   */
  private resolveConnectionId(explicitConnectionId?: string): string | undefined {
    return explicitConnectionId ?? this.diagnostics.readDataDbContext()?.connectionId;
  }

  /**
   * Classification is BYODB first when a data-database context is known (CLS, or the opaque
   * connection id already on the span): that classifier recognises pinned-pooler failure
   * modes the generic chain cannot. No error means no classification, and no CLS read.
   */
  private classificationFor(
    error: unknown,
    explicitConnectionId?: string
  ): IDatabaseErrorClassification | undefined {
    if (!error) {
      return undefined;
    }
    const dataDbContext = this.diagnostics.readDataDbContext();
    const connectionId = explicitConnectionId ?? dataDbContext?.connectionId;
    const dataDbClassification =
      dataDbContext || connectionId ? classifyDataDbRuntimeError(error) : null;
    return classifyDatabaseError(error, { dataDbClassification });
  }

  private reportFailure(input: {
    attributes: {
      instanceId: string;
      role: DatabaseHealthRole;
      operation: string;
      durationMs: number;
      trace: IObservedTrace;
    };
    classification: IDatabaseErrorClassification;
    error?: IObservedError;
  }): void {
    this.diagnostics.emitDatabaseError({
      instanceId: input.attributes.instanceId,
      role: input.attributes.role,
      operation: input.attributes.operation,
      durationMs: input.attributes.durationMs,
      classification: input.classification,
      ...(input.error?.message ? { message: input.error.message } : {}),
      traceId: input.attributes.trace.traceId,
      spanId: input.attributes.trace.spanId,
      spanName: input.attributes.trace.spanName,
    });
  }
}

/**
 * Reads a span into the bounded observation the metric service accepts.
 *
 * `status.message` carries pg's raw error text and `exception.message` the sanitized
 * `(code: SQLSTATE)` form; both are read but neither is ever logged directly — the
 * diagnostic emitter redacts whatever it is given.
 */
const readSpanFailure = (
  span: ReadableSpan,
  attributes: Attributes
): { error?: IObservedError } => {
  const exceptionMessage = readStringAttribute(attributes['exception.message']);
  const statusMessage =
    typeof span.status?.message === 'string' && span.status.message
      ? span.status.message
      : undefined;
  const failed =
    span.status?.code === SpanStatusCode.ERROR ||
    Boolean(exceptionMessage) ||
    Boolean(statusMessage) ||
    Boolean(readStringAttribute(attributes['status_message'])) ||
    Boolean(readStringAttribute(attributes['status_code_string']));
  if (!failed) {
    return {};
  }
  const code =
    readStringAttribute(attributes['exception.code']) ??
    extractSpanErrorCode(exceptionMessage) ??
    extractSpanErrorCode(statusMessage);
  const message =
    statusMessage ?? exceptionMessage ?? readStringAttribute(attributes['status_message']);
  return { error: { ...(code ? { code } : {}), ...(message ? { message } : {}) } };
};

const readSpanTrace = (span: ReadableSpan, spanName: string): IObservedTrace => {
  const spanContext = span.spanContext?.();
  return {
    traceId: spanContext?.traceId ?? '',
    spanId: spanContext?.spanId ?? '',
    spanName,
  };
};

export class DatabaseHealthSpanProcessor implements SpanProcessor {
  private readonly logger = new Logger(DatabaseHealthSpanProcessor.name);
  private loggedFailure = false;

  constructor(private readonly metricsService: DatabaseHealthMetricsService) {}

  onStart(_span: Span, _parentContext?: Context): void {
    // Nothing to do: attributes are read once the span carries its final values.
  }

  onEnd(span: ReadableSpan): void {
    try {
      this.handleSpan(span);
    } catch (error) {
      // Observation never affects the traced work, and a broken span must not spam logs.
      if (!this.loggedFailure) {
        this.loggedFailure = true;
        this.logger.debug(
          `Database health span processing failed; further failures are not logged: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  private handleSpan(span: ReadableSpan): void {
    const spanName = span.name ?? '';
    const attributes = span.attributes ?? {};

    // Anti-double-count rule: `prisma:*` spans are a second copy of the same SQL that
    // instrumentation-pg already reports as `pg.query:*` (Prisma runs through the same pg
    // pool). Observing both would double every query count and duration. The skip happens
    // before the db.system check, because Prisma sets db.system=postgresql too.
    if (spanName.startsWith('prisma:')) {
      return;
    }

    const dbSystem = attributes['db.system.name'] ?? attributes['db.system'];
    const isPostgres = dbSystem === 'postgresql' || dbSystem === 'postgres';
    const isPoolConnectSpan = spanName === PG_POOL_CONNECT_SPAN_NAME;
    // `pg-pool.connect` starts with `pg-`, not `pg.`, so it needs its own arm.
    if (!spanName.startsWith('pg.') && !isPoolConnectSpan && !isPostgres) {
      return;
    }

    if (isPoolConnectSpan) {
      this.handleAcquire(span, attributes);
      return;
    }
    if (spanName !== PG_QUERY_SPAN_PREFIX && !spanName.startsWith(`${PG_QUERY_SPAN_PREFIX}:`)) {
      // e.g. `pg.connect`/`pg-pool.end`: physical connections are counted from pool `connect`
      // events, which exist whether or not the pool's connect patch is instrumented.
      return;
    }
    this.handleQuery(span, spanName, attributes);
  }

  private handleQuery(span: ReadableSpan, spanName: string, attributes: Attributes): void {
    this.metricsService.recordQuery({
      instanceId: resolveDatabaseInstanceFromSpanAttributes(attributes),
      role: readSpanRole(attributes),
      operation: readSpanOperation(spanName, attributes),
      durationMs: readSpanDurationMs(span),
      ...readQueriedConnectionId(attributes),
      ...readSpanFailure(span, attributes),
      trace: readSpanTrace(span, spanName),
    });
  }

  private handleAcquire(span: ReadableSpan, attributes: Attributes): void {
    this.metricsService.recordAcquire({
      instanceId: resolveDatabaseInstanceFromSpanAttributes(attributes),
      role: readSpanRole(attributes),
      poolName:
        readStringAttribute(attributes['db.client.connection.pool.name']) ??
        readStringAttribute(attributes['teable.database.pool.name']) ??
        'shared',
      durationMs: readSpanDurationMs(span),
      ...readSpanFailure(span, attributes),
      trace: readSpanTrace(span, span.name ?? PG_POOL_CONNECT_SPAN_NAME),
    });
  }
}

/** Process-wide instances: one set of instruments, shared by DI and `tracing.ts`. */
export const databaseHealthMetrics = new DatabaseHealthMetricsService();
export const databaseHealthSpanProcessor = new DatabaseHealthSpanProcessor(databaseHealthMetrics);
