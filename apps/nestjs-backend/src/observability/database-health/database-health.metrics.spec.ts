/* eslint-disable @typescript-eslint/naming-convention */
// Span/attribute names in this spec are OTel semantic-convention strings.
import { metrics, SpanStatusCode, type Span } from '@opentelemetry/api';
import { metrics as sdkMetrics } from '@opentelemetry/sdk-node';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { IPgPoolSnapshot } from '@teable/db-main-prisma';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IDatabaseHealthDataDbContext,
  IDatabaseHealthDiagnosticsPort,
} from './database-health.diagnostics';
import type { IDatabaseHealthErrorInput } from './database-health.diagnostics';
import {
  DATABASE_HEALTH_ATTRIBUTE,
  DATABASE_HEALTH_METRIC,
  DATABASE_LATENCY_BUCKETS_MS,
  DatabaseHealthMetricsService,
  DatabaseHealthSpanProcessor,
} from './database-health.metrics';
import { resolveDatabaseInstanceId } from './database-instance';

const span = (input: {
  name: string;
  attributes?: Record<string, unknown>;
  statusCode?: SpanStatusCode;
  statusMessage?: string;
  durationMs?: number;
  traceId?: string;
  spanId?: string;
}): ReadableSpan =>
  ({
    name: input.name,
    attributes: input.attributes ?? {},
    status: {
      code: input.statusCode ?? SpanStatusCode.UNSET,
      ...(input.statusMessage ? { message: input.statusMessage } : {}),
    },
    duration: [
      Math.floor((input.durationMs ?? 10) / 1000),
      ((input.durationMs ?? 10) % 1000) * 1e6,
    ],
    spanContext: () => ({
      traceId: input.traceId ?? '0af7651916cd43dd8448eb211c80319c',
      spanId: input.spanId ?? 'b7ad6b7169203331',
      traceFlags: 1,
    }),
  }) as unknown as ReadableSpan;

const instanceIdOf = (host: string, port: number) => resolveDatabaseInstanceId({ host, port });

describe('database health metrics and span processor', () => {
  let provider: InstanceType<typeof sdkMetrics.MeterProvider>;
  let exporter: InstanceType<typeof sdkMetrics.InMemoryMetricExporter>;
  let service: DatabaseHealthMetricsService;
  let processor: DatabaseHealthSpanProcessor;
  let emitted: IDatabaseHealthErrorInput[];
  let dataDbContext: IDatabaseHealthDataDbContext | undefined;

  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('PRISMA_DATABASE_URL', '');
    vi.stubEnv('PRISMA_META_DATABASE_URL', '');
    metrics.disable();
    exporter = new sdkMetrics.InMemoryMetricExporter(sdkMetrics.AggregationTemporality.CUMULATIVE);
    provider = new sdkMetrics.MeterProvider({
      readers: [
        new sdkMetrics.PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 }),
      ],
    });
    metrics.setGlobalMeterProvider(provider);
    emitted = [];
    dataDbContext = undefined;
    const diagnostics: IDatabaseHealthDiagnosticsPort = {
      readDataDbContext: () => dataDbContext,
      emitDatabaseError: (input) => {
        emitted.push(input);
        return undefined;
      },
    };
    service = new DatabaseHealthMetricsService(diagnostics);
    processor = new DatabaseHealthSpanProcessor(service);
  });

  afterEach(async () => {
    await provider.shutdown();
    metrics.disable();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const points = async (name: string) => {
    exporter.reset();
    await provider.forceFlush();
    return (
      exporter
        .getMetrics()
        .at(-1)
        ?.scopeMetrics.flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === name)
        .flatMap((metric) =>
          metric.dataPoints.map(({ attributes, value }) => ({ attributes, value }))
        ) ?? []
    );
  };

  it('counts a successful query once per instance with operation, role and outcome', async () => {
    processor.onEnd(
      span({
        name: 'pg.query:SELECT app',
        attributes: {
          'db.namespace': 'app',
          'db.system.name': 'postgresql',
          'server.address': 'db.example.com',
          'server.port': 5432,
          'teable.db.role': 'data',
        },
        durationMs: 30,
      })
    );

    expect(await points(DATABASE_HEALTH_METRIC.operations)).toEqual([
      {
        attributes: {
          [DATABASE_HEALTH_ATTRIBUTE.instanceId]: instanceIdOf('db.example.com', 5432),
          [DATABASE_HEALTH_ATTRIBUTE.operation]: 'SELECT',
          [DATABASE_HEALTH_ATTRIBUTE.outcome]: 'success',
          [DATABASE_HEALTH_ATTRIBUTE.role]: 'data',
        },
        value: 1,
      },
    ]);
    expect(await points(DATABASE_HEALTH_METRIC.operationDuration)).toMatchObject([
      {
        attributes: {
          [DATABASE_HEALTH_ATTRIBUTE.instanceId]: instanceIdOf('db.example.com', 5432),
          [DATABASE_HEALTH_ATTRIBUTE.operation]: 'SELECT',
          [DATABASE_HEALTH_ATTRIBUTE.role]: 'data',
        },
        value: { count: 1, buckets: { boundaries: DATABASE_LATENCY_BUCKETS_MS } },
      },
    ]);
    expect(emitted).toHaveLength(0);
  });

  it('records the error class on the counter and still records the latency for failures', async () => {
    processor.onEnd(
      span({
        name: 'pg.query:INSERT teable',
        attributes: {
          'db.system.name': 'postgresql',
          'server.address': 'db.example.com',
          'server.port': 5432,
          'teable.db.role': 'meta',
        },
        statusCode: SpanStatusCode.ERROR,
        statusMessage: 'duplicate key value violates unique constraint "users_email_key"',
        durationMs: 5,
        spanId: 'aaaa0000bbbb1111',
      })
    );

    expect(await points(DATABASE_HEALTH_METRIC.operations)).toEqual([
      {
        attributes: {
          [DATABASE_HEALTH_ATTRIBUTE.instanceId]: instanceIdOf('db.example.com', 5432),
          [DATABASE_HEALTH_ATTRIBUTE.operation]: 'INSERT',
          [DATABASE_HEALTH_ATTRIBUTE.outcome]: 'error',
          [DATABASE_HEALTH_ATTRIBUTE.role]: 'meta',
          [DATABASE_HEALTH_ATTRIBUTE.errorClass]: 'unique_violation',
        },
        value: 1,
      },
    ]);
    expect(await points(DATABASE_HEALTH_METRIC.operationDuration)).toMatchObject([
      { value: { count: 1 } },
    ]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      instanceId: instanceIdOf('db.example.com', 5432),
      role: 'meta',
      operation: 'INSERT',
      durationMs: 5,
      spanName: 'pg.query:INSERT teable',
      spanId: 'aaaa0000bbbb1111',
      message: 'duplicate key value violates unique constraint "users_email_key"',
      classification: { errorClass: 'unique_violation' },
    });
  });

  it('classifies through the SQLSTATE pg hides in the sanitized span exception', async () => {
    processor.onEnd(
      span({
        name: 'pg.query:SELECT app',
        attributes: {
          'db.system.name': 'postgresql',
          'server.address': 'db.example.com',
          'exception.message': "PostgreSQL error of type 'PostgreSQLError' occurred (code: 57014)",
        },
        statusCode: SpanStatusCode.ERROR,
        statusMessage: 'canceling statement due to statement timeout',
      })
    );

    expect(await points(DATABASE_HEALTH_METRIC.operations)).toMatchObject([
      {
        attributes: {
          [DATABASE_HEALTH_ATTRIBUTE.outcome]: 'error',
          [DATABASE_HEALTH_ATTRIBUTE.errorClass]: 'statement_timeout',
        },
      },
    ]);
  });

  it('records spans without an endpoint under the documented unknown instance id', async () => {
    expect(() =>
      processor.onEnd(
        span({ name: 'pg.query:WITH app', attributes: { 'db.system': 'postgresql' } })
      )
    ).not.toThrow();

    expect(await points(DATABASE_HEALTH_METRIC.operations)).toEqual([
      {
        attributes: {
          [DATABASE_HEALTH_ATTRIBUTE.instanceId]: 'dbh_unknown',
          [DATABASE_HEALTH_ATTRIBUTE.operation]: 'WITH',
          [DATABASE_HEALTH_ATTRIBUTE.outcome]: 'success',
          [DATABASE_HEALTH_ATTRIBUTE.role]: 'unknown',
        },
        value: 1,
      },
    ]);
  });

  it('ignores prisma spans so a statement is never counted twice', async () => {
    processor.onEnd(
      span({
        name: 'prisma:engine:db_query',
        attributes: {
          'db.system.name': 'postgresql',
          'db.namespace': 'app',
          'server.address': 'db.example.com',
          'server.port': 5432,
        },
        durationMs: 30,
      })
    );
    processor.onEnd(
      span({
        name: 'prisma:client:operation',
        attributes: { 'db.system': 'postgresql', 'db.operation.name': 'SELECT' },
        durationMs: 30,
      })
    );
    expect(await points(DATABASE_HEALTH_METRIC.operations)).toHaveLength(0);
    expect(await points(DATABASE_HEALTH_METRIC.operationDuration)).toHaveLength(0);

    processor.onEnd(
      span({
        name: 'pg.query:SELECT app',
        attributes: { 'db.system.name': 'postgresql', 'server.address': 'db.example.com' },
      })
    );
    expect(await points(DATABASE_HEALTH_METRIC.operations)).toMatchObject([{ value: 1 }]);
  });

  it('ignores spans that are neither pg nor postgres', async () => {
    processor.onEnd(span({ name: 'http.client.request', attributes: { 'server.address': 'x' } }));

    expect(await points(DATABASE_HEALTH_METRIC.operations)).toHaveLength(0);
    expect(await points(DATABASE_HEALTH_METRIC.acquireDuration)).toHaveLength(0);
  });

  it('records pool acquisition latency and timeouts from pg-pool.connect spans', async () => {
    processor.onEnd(
      span({
        name: 'pg-pool.connect',
        attributes: { 'server.address': 'db.example.com', 'server.port': 5432 },
        durationMs: 12,
      })
    );
    expect(await points(DATABASE_HEALTH_METRIC.acquireDuration)).toMatchObject([
      {
        attributes: {
          [DATABASE_HEALTH_ATTRIBUTE.instanceId]: instanceIdOf('db.example.com', 5432),
          [DATABASE_HEALTH_ATTRIBUTE.outcome]: 'success',
          [DATABASE_HEALTH_ATTRIBUTE.poolName]: 'shared',
          [DATABASE_HEALTH_ATTRIBUTE.role]: 'unknown',
        },
        value: { count: 1, buckets: { boundaries: DATABASE_LATENCY_BUCKETS_MS } },
      },
    ]);
    expect(await points(DATABASE_HEALTH_METRIC.acquireTimeouts)).toHaveLength(0);

    processor.onEnd(
      span({
        name: 'pg-pool.connect',
        attributes: {
          'db.client.connection.pool.name': 'observation',
          'server.address': 'db.example.com',
          'server.port': 5432,
        },
        statusCode: SpanStatusCode.ERROR,
        statusMessage: 'timeout exceeded when trying to connect',
        durationMs: 5000,
      })
    );

    expect(await points(DATABASE_HEALTH_METRIC.acquireDuration)).toEqual(
      expect.arrayContaining([
        {
          attributes: expect.objectContaining({
            [DATABASE_HEALTH_ATTRIBUTE.poolName]: 'observation',
            [DATABASE_HEALTH_ATTRIBUTE.outcome]: 'error',
          }),
          value: expect.objectContaining({ count: 1 }),
        },
        {
          attributes: expect.objectContaining({
            [DATABASE_HEALTH_ATTRIBUTE.poolName]: 'shared',
            [DATABASE_HEALTH_ATTRIBUTE.outcome]: 'success',
          }),
          value: expect.objectContaining({ count: 1 }),
        },
      ])
    );
    expect(await points(DATABASE_HEALTH_METRIC.acquireTimeouts)).toEqual([
      {
        attributes: {
          [DATABASE_HEALTH_ATTRIBUTE.instanceId]: instanceIdOf('db.example.com', 5432),
          [DATABASE_HEALTH_ATTRIBUTE.role]: 'unknown',
        },
        value: 1,
      },
    ]);
    expect(await points(DATABASE_HEALTH_METRIC.connectionFailures)).toEqual([
      {
        attributes: {
          [DATABASE_HEALTH_ATTRIBUTE.errorClass]: 'connection_timeout',
          [DATABASE_HEALTH_ATTRIBUTE.failurePhase]: 'acquire',
          [DATABASE_HEALTH_ATTRIBUTE.instanceId]: instanceIdOf('db.example.com', 5432),
          [DATABASE_HEALTH_ATTRIBUTE.role]: 'unknown',
        },
        value: 1,
      },
    ]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ operation: 'acquire', spanName: 'pg-pool.connect' });
  });

  it('adds the data-db connection id only when a data-db context exists', async () => {
    const querySpan = () =>
      span({
        name: 'pg.query:SELECT app',
        attributes: {
          'db.system.name': 'postgresql',
          'server.address': 'aws-1-us-west-2.pooler.supabase.com',
          'teable.db.role': 'data',
        },
      });

    processor.onEnd(querySpan());
    const withoutContext = await points(DATABASE_HEALTH_METRIC.operations);
    expect(withoutContext[0].attributes).not.toHaveProperty(DATABASE_HEALTH_ATTRIBUTE.connectionId);

    dataDbContext = { connectionId: 'cmr123' };
    processor.onEnd(querySpan());
    const withContext = await points(DATABASE_HEALTH_METRIC.operations);
    const attributeSets = withContext.map((point) => point.attributes);
    expect(attributeSets[1]).toMatchObject({
      [DATABASE_HEALTH_ATTRIBUTE.connectionId]: 'cmr123',
    });
    expect(attributeSets.every((attributes) => !Object.values(attributes).includes(''))).toBe(true);

    // The span's own opaque id wins over the CLS one for the same observation.
    processor.onEnd(
      span({
        name: 'pg.query:SELECT app',
        attributes: {
          'db.system.name': 'postgresql',
          'server.address': 'aws-1-us-west-2.pooler.supabase.com',
          'teable.data_db.connection_id': 'cmrFromSpan',
        },
      })
    );
    expect(
      (await points(DATABASE_HEALTH_METRIC.operationDuration)).map(
        (point) => point.attributes[DATABASE_HEALTH_ATTRIBUTE.connectionId]
      )
    ).toContain('cmrFromSpan');
  });

  it('reports physical connections, idle failures and physical connect failures from the pool', async () => {
    const snapshot: IPgPoolSnapshot = {
      applicationName: 'teable',
      database: 'teable',
      host: 'meta.example.com',
      idle: 1,
      max: 20,
      port: 5432,
      references: 2,
      total: 3,
      waiting: 0,
    };
    vi.stubEnv('PRISMA_META_DATABASE_URL', 'postgresql://teable@meta.example.com:5432/teable');

    service.onPoolCreated(snapshot);
    service.onConnectEstablished(snapshot);

    expect(await points(DATABASE_HEALTH_METRIC.connectionsEstablished)).toEqual([
      {
        attributes: {
          [DATABASE_HEALTH_ATTRIBUTE.instanceId]: instanceIdOf('meta.example.com', 5432),
          [DATABASE_HEALTH_ATTRIBUTE.poolName]: 'shared',
          [DATABASE_HEALTH_ATTRIBUTE.role]: 'meta',
        },
        value: 1,
      },
    ]);

    service.onPoolError(snapshot, new Error('Connection terminated unexpectedly'));
    service.onAcquireFailure(
      snapshot,
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      'connect',
      30
    );
    // The pooled `pg-pool.connect` span owns the `acquire` phase: reporting it here too
    // would count one rejected acquisition twice.
    service.onAcquireFailure(snapshot, { code: '53300' }, 'acquire', 30);

    expect(await points(DATABASE_HEALTH_METRIC.connectionFailures)).toEqual(
      expect.arrayContaining([
        {
          attributes: {
            [DATABASE_HEALTH_ATTRIBUTE.errorClass]: 'connection_lost',
            [DATABASE_HEALTH_ATTRIBUTE.failurePhase]: 'idle',
            [DATABASE_HEALTH_ATTRIBUTE.instanceId]: instanceIdOf('meta.example.com', 5432),
            [DATABASE_HEALTH_ATTRIBUTE.poolName]: 'shared',
            [DATABASE_HEALTH_ATTRIBUTE.role]: 'meta',
          },
          value: 1,
        },
        {
          attributes: {
            [DATABASE_HEALTH_ATTRIBUTE.errorClass]: 'connection_failed',
            [DATABASE_HEALTH_ATTRIBUTE.failurePhase]: 'connect',
            [DATABASE_HEALTH_ATTRIBUTE.instanceId]: instanceIdOf('meta.example.com', 5432),
            [DATABASE_HEALTH_ATTRIBUTE.poolName]: 'shared',
            [DATABASE_HEALTH_ATTRIBUTE.role]: 'meta',
          },
          value: 1,
        },
      ])
    );
    // No third point: the `acquire` phase belongs to the pg-pool.connect spans.
    expect(await points(DATABASE_HEALTH_METRIC.connectionFailures)).toHaveLength(2);
  });

  it('resolves pool roles from the configured URLs, not from the request context', async () => {
    vi.stubEnv('PRISMA_META_DATABASE_URL', 'postgresql://teable@db.example.com:5432/teable');
    const tenant: IPgPoolSnapshot = {
      applicationName: 'teable',
      database: 'tenant_a',
      host: 'tenant.pooler.example.com',
      idle: 0,
      max: 10,
      poolName: 'tenant',
      port: 6543,
      references: 1,
      total: 1,
      waiting: 0,
    };

    service.onConnectEstablished(tenant);

    expect(await points(DATABASE_HEALTH_METRIC.connectionsEstablished)).toEqual([
      {
        attributes: {
          [DATABASE_HEALTH_ATTRIBUTE.instanceId]: instanceIdOf('tenant.pooler.example.com', 6543),
          [DATABASE_HEALTH_ATTRIBUTE.poolName]: 'tenant',
          [DATABASE_HEALTH_ATTRIBUTE.role]: 'data',
        },
        value: 1,
      },
    ]);
  });

  it('keeps unreadable spans and a broken diagnostics sink inside the instrumentation', async () => {
    const brokenSpan = {
      get name(): string {
        throw new Error('unreadable span');
      },
    } as unknown as ReadableSpan;

    expect(() => processor.onEnd(brokenSpan)).not.toThrow();
    await expect(processor.shutdown()).resolves.toBeUndefined();
    await expect(processor.forceFlush()).resolves.toBeUndefined();

    processor.onEnd(
      span({
        name: 'pg.query:SELECT app',
        attributes: { 'db.system.name': 'postgresql', 'server.address': 'db.example.com' },
      })
    );
    expect(await points(DATABASE_HEALTH_METRIC.operations)).toMatchObject([{ value: 1 }]);

    // A failing diagnostic sink must not turn a database error into a monitoring error.
    const failingSink = new DatabaseHealthSpanProcessor(
      new DatabaseHealthMetricsService({
        readDataDbContext: () => undefined,
        emitDatabaseError: () => {
          throw new Error('logger unavailable');
        },
      })
    );
    expect(() =>
      failingSink.onEnd(
        span({
          name: 'pg.query:SELECT app',
          attributes: { 'db.system.name': 'postgresql', 'server.address': 'db.example.com' },
          statusCode: SpanStatusCode.ERROR,
          statusMessage: 'duplicate key value violates unique constraint "x"',
        })
      )
    ).not.toThrow();
  });

  it('never creates, ends or mutates the spans it observes', () => {
    const mutations = {
      addEvent: 0,
      end: 0,
      recordException: 0,
      setAttribute: 0,
      setStatus: 0,
      updateName: 0,
    };
    const observed = {
      ...span({
        name: 'pg.query:SELECT app',
        attributes: { 'db.system.name': 'postgresql', 'server.address': 'db.example.com' },
      }),
      addEvent: () => (mutations.addEvent += 1),
      end: () => (mutations.end += 1),
      recordException: () => (mutations.recordException += 1),
      setAttribute: () => (mutations.setAttribute += 1),
      setStatus: () => (mutations.setStatus += 1),
      updateName: () => (mutations.updateName += 1),
    } as unknown as ReadableSpan;

    // The SDK hands `onStart` a writable Span, so the fake is widened for that call: the
    // point of the assertion is that the processor never touches it.
    processor.onStart(observed as unknown as Span, undefined);
    processor.onEnd(observed);

    expect(mutations).toEqual({
      addEvent: 0,
      end: 0,
      recordException: 0,
      setAttribute: 0,
      setStatus: 0,
      updateName: 0,
    });
  });
});
