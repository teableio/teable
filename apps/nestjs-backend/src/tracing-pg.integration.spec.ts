/* eslint-disable @typescript-eslint/naming-convention */
import { createRequire } from 'node:module';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type * as Pg from 'pg';
import { describe, expect, it } from 'vitest';
import { redactTeablePgQuerySpan, withPgParameterRedaction } from './tracing-db-context';

const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
const connectionString = process.env.PRISMA_DATABASE_URL;

// This opts into a real server and the installed PgInstrumentation, rather than mocking
// requestHook. The ordinary backend suite never needs a PostgreSQL connection.
describePg('structured query PostgreSQL span parameter redaction', () => {
  it('preserves results and scoped spans without leaking values or redacting concurrent callers', async () => {
    if (!connectionString) throw new Error('PRISMA_DATABASE_URL is required for PG integration');
    const exporter = new InMemorySpanExporter();
    const processor = new SimpleSpanProcessor(exporter);
    const sdk = new NodeSDK({
      autoDetectResources: false,
      logRecordProcessors: [],
      metricReaders: [],
      contextManager: new AsyncLocalStorageContextManager(),
      spanProcessors: [processor],
      instrumentations: [
        new PgInstrumentation({
          enhancedDatabaseReporting: true,
          requireParentSpan: false,
          requestHook: redactTeablePgQuerySpan,
        }),
      ],
    });
    sdk.start();
    // Load through Node after instrumentation starts, not through Vite's module loader.
    const pg: typeof Pg = createRequire(import.meta.url)('pg');
    const pool = new pg.Pool({ connectionString, max: 2 });
    const tracer = trace.getTracer('teable-structured-query-regression');
    const secret = 'structured-query-bind-sentinel';
    const query = (name: string, value: string) =>
      tracer.startActiveSpan(name, async (span) => {
        try {
          const result = await pool.query<{ value: string }>('SELECT $1::text AS value', [value]);
          return { rows: result.rows, traceId: span.spanContext().traceId };
        } finally {
          span.end();
        }
      });
    const failureStatement = 'SELECT 1::integer = $1 AS matches';
    const failureSecret = 'pg-error-bind-sentinel-3bee565a';
    const failureModes = ['promise', 'callback', 'query-callback'] as const;
    const failingQuery = (name: string, value: string, mode: (typeof failureModes)[number]) =>
      tracer.startActiveSpan(name, async (span) => {
        const client = await pool.connect();
        try {
          let result: Promise<Pg.QueryResult>;
          if (mode === 'promise') {
            result = client.query(failureStatement, [value]);
          } else {
            result = new Promise<Pg.QueryResult>((resolve, reject) => {
              const callback = (error: Error | undefined, rows: Pg.QueryResult) =>
                error ? reject(error) : resolve(rows);
              if (mode === 'callback') {
                client.query(failureStatement, [value], callback);
              } else {
                client.query(new pg.Query({ text: failureStatement, values: [value] }, callback));
              }
            });
          }
          // Prove PostgreSQL echoes this bound value in its error, without mutating it for callers.
          await expect(result).rejects.toMatchObject({
            code: '22P02',
            message: expect.stringContaining(value),
          });
          return span.spanContext().traceId;
        } finally {
          client.release();
          span.end();
        }
      });
    try {
      const [scoped, concurrent] = await Promise.all([
        withPgParameterRedaction(() => query('structured-query', secret)),
        query('legacy-query', 'legacy-value'),
      ]);
      const following = await query('following-query', 'following-value');
      expect(scoped.rows).toEqual([{ value: secret }]);
      expect(concurrent.rows).toEqual([{ value: 'legacy-value' }]);
      expect(following.rows).toEqual([{ value: 'following-value' }]);
      const [scopedFailures, concurrentFailure] = await Promise.all([
        Promise.all(
          failureModes.map((mode) =>
            withPgParameterRedaction(() => failingQuery(`scoped-${mode}`, failureSecret, mode))
          )
        ),
        failingQuery('legacy-failure', 'legacy-error-value', 'promise'),
      ]);
      const followingFailure = await failingQuery(
        'following-failure',
        'following-error-value',
        'callback'
      );
      await processor.forceFlush();
      const spans = exporter.getFinishedSpans();
      const valuesFor = (traceId: string) =>
        spans
          .filter(
            (span) =>
              span.spanContext().traceId === traceId &&
              span.attributes['db.query.text'] === 'SELECT $1::text AS value'
          )
          .map((span) => span.attributes['db.postgresql.values']);
      expect(valuesFor(scoped.traceId)).toEqual(['[REDACTED]']);
      expect(valuesFor(concurrent.traceId)).toEqual([['legacy-value']]);
      expect(valuesFor(following.traceId)).toEqual([['following-value']]);
      const privateTrace = spans.filter((span) => span.spanContext().traceId === scoped.traceId);
      expect(
        JSON.stringify(
          privateTrace.map((span) => ({
            status: span.status,
            attributes: span.attributes,
            events: span.events,
          }))
        )
      ).not.toContain(secret);
      for (const traceId of scopedFailures) {
        const privateFailureTrace = spans.filter((span) => span.spanContext().traceId === traceId);
        const querySpans = privateFailureTrace.filter(
          (span) => span.attributes['db.query.text'] === failureStatement
        );
        expect(querySpans).toHaveLength(1);
        const [querySpan] = querySpans;
        expect(querySpan.status).toEqual({
          code: SpanStatusCode.ERROR,
          message: 'PostgreSQL query failed (details redacted)',
        });
        expect(querySpan.attributes['db.postgresql.values']).toBe('[REDACTED]');
        expect(querySpan.attributes['error.type']).toBe('22P02');
        expect(querySpan.events).toEqual([
          {
            name: 'exception',
            time: expect.any(Array),
            attributes: {
              'exception.type': 'PostgreSQLError',
              'exception.message': 'PostgreSQL query failed (details redacted)',
            },
            droppedAttributesCount: 0,
          },
        ]);
        expect(
          JSON.stringify(
            privateFailureTrace.map((span) => ({
              status: span.status,
              attributes: span.attributes,
              events: span.events,
            }))
          )
        ).not.toContain(failureSecret);
      }
      for (const [traceId, value] of [
        [concurrentFailure, 'legacy-error-value'],
        [followingFailure, 'following-error-value'],
      ]) {
        const querySpans = spans.filter(
          (span) =>
            span.spanContext().traceId === traceId &&
            span.attributes['db.query.text'] === failureStatement
        );
        expect(querySpans).toHaveLength(1);
        expect(querySpans[0].status).toEqual({
          code: SpanStatusCode.ERROR,
          message: expect.stringContaining(value),
        });
        expect(querySpans[0].attributes['db.postgresql.values']).toEqual([value]);
        expect(querySpans[0].events[0].attributes?.['exception.message']).toBe(
          "PostgreSQL error of type 'error' occurred (code: 22P02)"
        );
      }
    } finally {
      await pool.end();
      await sdk.shutdown();
    }
  });
});
