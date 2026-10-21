/* eslint-disable @typescript-eslint/naming-convention */
import { context, SpanStatusCode } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  parseDatabaseUrl,
  parseDatabaseUrlCache,
  redactTeablePgQuerySpan,
  resolveTeableDbTraceContext,
  setTeableDbSpanAttributes,
  setTeableDbSpanAttributesFromSpan,
  withPgParameterRedaction,
} from './tracing-db-context';

describe('parseDatabaseUrl memoization', () => {
  beforeEach(() => {
    parseDatabaseUrlCache.clear();
  });

  it('returns the same object reference for repeated calls', () => {
    const url = 'postgresql://user:pass@host:5432/db';
    const a = parseDatabaseUrl(url);
    const b = parseDatabaseUrl(url);
    expect(a).toBe(b);
    expect(a).toEqual({
      database: 'db',
      host: 'host',
      port: 5432,
      user: 'user',
      url: 'postgresql://user@host:5432/db',
    });
  });

  it('does not cache unparseable URLs', () => {
    expect(parseDatabaseUrl('not-a-url')).toBeUndefined();
    expect(parseDatabaseUrlCache.has('not-a-url')).toBe(false);
    expect(parseDatabaseUrl('not-a-url')).toBeUndefined();
  });

  it('does not cache when input is falsy', () => {
    expect(parseDatabaseUrl(undefined)).toBeUndefined();
    expect(parseDatabaseUrl('')).toBeUndefined();
    expect(parseDatabaseUrlCache.size).toBe(0);
  });

  it('evicts least-recently-used entries at capacity', () => {
    for (let i = 0; i < 100; i++) {
      parseDatabaseUrl(`postgresql://u:p@host${i}:5432/db`);
    }
    expect(parseDatabaseUrlCache.size).toBe(100);

    parseDatabaseUrl('postgresql://u:p@host-overflow:5432/db');
    expect(parseDatabaseUrlCache.size).toBe(100);
    expect(parseDatabaseUrlCache.has('postgresql://u:p@host0:5432/db')).toBe(false);
    expect(parseDatabaseUrlCache.has('postgresql://u:p@host-overflow:5432/db')).toBe(true);
  });
});

describe('tracing db context', () => {
  beforeEach(() => {
    parseDatabaseUrlCache.clear();
  });

  const env = {
    PRISMA_DATABASE_URL: 'postgresql://postgres:secret@meta.example.test:5433/teable',
  };

  it('marks connections matching the meta URL as meta and redacts the password', () => {
    expect(
      resolveTeableDbTraceContext(
        {
          database: 'teable',
          host: 'meta.example.test',
          port: 5433,
          user: 'postgres',
        },
        env
      )
    ).toEqual({
      role: 'meta',
      source: 'PRISMA_DATABASE_URL',
      url: 'postgresql://postgres@meta.example.test:5433/teable',
    });
  });

  it('marks non-meta postgres connections as dynamic data DB connections', () => {
    expect(
      resolveTeableDbTraceContext(
        {
          database: 'postgres',
          host: 'byodb.example.test',
          port: 5544,
          user: 'postgres',
        },
        env
      )
    ).toEqual({
      role: 'data',
      source: 'inferred.non_meta_postgres',
      url: 'postgresql://postgres@byodb.example.test:5544/postgres',
    });
  });

  it('writes teable db attributes to query spans', () => {
    const span = { setAttribute: vi.fn() };

    setTeableDbSpanAttributes(
      span,
      {
        database: 'teable',
        host: 'meta.example.test',
        port: 5433,
        user: 'postgres',
      },
      env
    );

    expect(span.setAttribute).toHaveBeenCalledWith('teable.db.role', 'meta');
    expect(span.setAttribute).toHaveBeenCalledWith(
      'teable.db.url',
      'postgresql://postgres@meta.example.test:5433/teable'
    );
    expect(span.setAttribute).toHaveBeenCalledWith('teable.db.source', 'PRISMA_DATABASE_URL');
  });

  it('writes teable db attributes to connection spans from existing span attributes', () => {
    const span = {
      attributes: {
        'db.name': 'teable_data',
        'db.user': 'postgres',
        'net.peer.name': 'data.example.test',
        'net.peer.port': 5434,
      },
      setAttribute: vi.fn(),
    };

    setTeableDbSpanAttributesFromSpan(span, env);

    expect(span.setAttribute).toHaveBeenCalledWith('teable.db.role', 'data');
    expect(span.setAttribute).toHaveBeenCalledWith(
      'teable.db.url',
      'postgresql://postgres@data.example.test:5434/teable_data'
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      'teable.db.source',
      'inferred.non_meta_postgres'
    );
  });
});

describe('scoped PostgreSQL span redaction', () => {
  let provider: BasicTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  });

  afterEach(async () => {
    context.disable();
    await provider.shutdown();
  });

  it('sanitizes synchronous error writes before export and retains SQLSTATE', () => {
    const secret = 'unit-pg-bind-sentinel-8228e197';
    const span = provider.getTracer('pg-redaction-test').startSpan('query');
    const time: [number, number] = [123, 456];
    span.setAttribute('db.postgresql.values', [secret]);
    withPgParameterRedaction(() => redactTeablePgQuerySpan(span));

    // instrumentation-pg records its sanitized exception, then the raw status, then ends.
    span.recordException("PostgreSQL error of type 'error' occurred (code: 22P02)", time);
    expect(span.setStatus({ code: SpanStatusCode.ERROR, message: secret })).toBe(span);
    span.end();

    const [finished] = exporter.getFinishedSpans();
    expect(finished.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'PostgreSQL query failed (details redacted)',
    });
    expect(finished.attributes).toEqual({
      'db.postgresql.values': '[REDACTED]',
      'error.type': '22P02',
    });
    expect(finished.events).toEqual([
      {
        name: 'exception',
        time,
        attributes: {
          'exception.type': 'PostgreSQLError',
          'exception.message': 'PostgreSQL query failed (details redacted)',
        },
        droppedAttributesCount: 0,
      },
    ]);
    expect(JSON.stringify(finished.status)).not.toContain(secret);
    expect(JSON.stringify(finished.attributes)).not.toContain(secret);
    expect(JSON.stringify(finished.events)).not.toContain(secret);
  });

  it.each([
    "PostgreSQL error of type 'unit-exception-sentinel' occurred (code: invalid-code)",
    'unit-exception-sentinel',
    new Error('unit-exception-sentinel'),
  ])('does not trust arbitrary exception content: %#', (exception) => {
    const span = provider.getTracer('pg-redaction-test').startSpan('query');
    withPgParameterRedaction(() => redactTeablePgQuerySpan(span));
    span.recordException(exception);
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'unit-exception-sentinel' });
    span.end();

    const [finished] = exporter.getFinishedSpans();
    expect(finished.attributes['error.type']).toBe('PostgreSQLError');
    expect(finished.events[0].attributes).toEqual({
      'exception.type': 'PostgreSQLError',
      'exception.message': 'PostgreSQL query failed (details redacted)',
    });
    expect(JSON.stringify({ status: finished.status, events: finished.events })).not.toContain(
      'unit-exception-sentinel'
    );
  });

  it('leaves concurrent and following unscoped spans untouched across async boundaries', async () => {
    const tracer = provider.getTracer('pg-redaction-test');
    const scoped = tracer.startSpan('scoped');
    const concurrent = tracer.startSpan('concurrent');
    const following = tracer.startSpan('following');
    const originalStatus = concurrent.setStatus;
    const originalException = concurrent.recordException;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const scopedTask = withPgParameterRedaction(async () => {
      await gate;
      redactTeablePgQuerySpan(scoped);
    });
    redactTeablePgQuerySpan(concurrent);
    expect(concurrent.setStatus).toBe(originalStatus);
    expect(concurrent.recordException).toBe(originalException);
    releaseGate();
    await scopedTask;
    redactTeablePgQuerySpan(following);

    for (const span of [scoped, concurrent, following]) {
      span.recordException('unscoped-error-value');
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'unscoped-error-value' });
      span.end();
    }
    const spans = exporter.getFinishedSpans();
    expect(spans[0].attributes['db.postgresql.values']).toBe('[REDACTED]');
    for (const span of spans.slice(1)) {
      expect(span.attributes['db.postgresql.values']).toBeUndefined();
      expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'unscoped-error-value' });
      expect(span.events[0].attributes?.['exception.message']).toBe('unscoped-error-value');
    }
  });
});
