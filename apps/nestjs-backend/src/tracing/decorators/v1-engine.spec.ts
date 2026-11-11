import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Span } from './span';
import { TEABLE_V1_ENGINE_ATTRIBUTE, V1Engine, V1EngineService } from './v1-engine';

@V1EngineService(['execute', 'nested', 'promise', 'fail', 'asynchronous', 'stream', 'failedStream'])
class LegacyBoundary {
  readonly result = { preserved: true };

  execute() {
    return this.nested();
  }

  @Span()
  nested() {
    return this.result;
  }

  promise(error?: Error) {
    return Promise.resolve().then(() => {
      if (error) throw error;
      return this.nested();
    });
  }

  fail(error: Error) {
    throw error;
  }

  async asynchronous(error?: Error) {
    await Promise.resolve();
    if (error) throw error;
    return this.nested();
  }

  async *stream(onClose: () => void) {
    try {
      yield this.nested();
      await Promise.resolve();
      yield this.nested();
    } finally {
      onClose();
    }
  }

  async *failedStream(error: Error) {
    yield await Promise.reject(error);
  }

  @Span()
  v2() {
    return this.result;
  }
}

class EnterpriseBoundary extends LegacyBoundary {
  @V1Engine()
  override execute() {
    return super.execute();
  }
}

describe('V1Engine execution spans', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let manager: AsyncLocalStorageContextManager;

  beforeEach(() => {
    trace.disable();
    context.disable();
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    manager = new AsyncLocalStorageContextManager().enable();
    context.setGlobalContextManager(manager);
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(async () => {
    await provider.shutdown();
    manager.disable();
    trace.disable();
    context.disable();
  });

  it('keeps HTTP parent and nested service spans distinct without mutating routing intent', () => {
    const service = new LegacyBoundary();
    trace
      .getTracer('test')
      .startActiveSpan('POST /table/:tableId', { kind: SpanKind.SERVER }, (http) => {
        expect(service.execute()).toBe(service.result);
        http.end();
      });
    const [nested, execution, http] = exporter.getFinishedSpans();
    expect(nested.attributes[TEABLE_V1_ENGINE_ATTRIBUTE]).toBe('LegacyBoundary.nested');
    expect(execution.attributes[TEABLE_V1_ENGINE_ATTRIBUTE]).toBe('LegacyBoundary.execute');
    expect(http.attributes[TEABLE_V1_ENGINE_ATTRIBUTE]).toBeUndefined();
    expect(nested.parentSpanContext?.spanId).toBe(execution.spanContext().spanId);
    expect(execution.parentSpanContext?.spanId).toBe(http.spanContext().spanId);
    expect(nested.spanContext().traceId).toBe(http.spanContext().traceId);
  });

  it('creates a root for direct in-process execution, with stable inherited/EE labels', () => {
    new EnterpriseBoundary().execute();
    const [nested, base, override] = exporter.getFinishedSpans();
    expect(override.attributes[TEABLE_V1_ENGINE_ATTRIBUTE]).toBe('EnterpriseBoundary.execute');
    expect(base.attributes[TEABLE_V1_ENGINE_ATTRIBUTE]).toBe('LegacyBoundary.execute');
    expect(nested.attributes[TEABLE_V1_ENGINE_ATTRIBUTE]).toBe('LegacyBoundary.nested');
    expect(override.parentSpanContext).toBeUndefined();
    expect(base.parentSpanContext?.spanId).toBe(override.spanContext().spanId);
  });

  it('does not label v2 execution in a mixed service', () => {
    new LegacyBoundary().v2();
    expect(exporter.getFinishedSpans()[0].attributes[TEABLE_V1_ENGINE_ATTRIBUTE]).toBeUndefined();
  });

  it.each(['promise', 'asynchronous'] as const)(
    'awaits %s completion and preserves async context',
    async (method) => {
      const service = new LegacyBoundary();
      const pending = service[method]();
      expect(exporter.getFinishedSpans()).toHaveLength(0);
      expect(await pending).toBe(service.result);
      const [nested, outer] = exporter.getFinishedSpans();
      expect(nested.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
    }
  );

  it.each(['promise', 'asynchronous'] as const)(
    'preserves %s rejection and records it',
    async (method) => {
      const error = new Error('failure');
      await expect(new LegacyBoundary()[method](error)).rejects.toBe(error);
      const [span] = exporter.getFinishedSpans();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.events[0].name).toBe('exception');
    }
  );

  it('preserves synchronous throws without turning them into promises', () => {
    const error = new Error('failure');
    expect(() => new LegacyBoundary().fail(error)).toThrow(error);
    expect(exporter.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.ERROR);
  });

  it('keeps generators lazy, propagates context on pulls and ends on cancellation', async () => {
    let closed = false;
    const iterator = new LegacyBoundary().stream(() => {
      closed = true;
    });
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(trace.getActiveSpan()).toBeUndefined();
    await iterator.next();
    expect(closed).toBe(false);
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(trace.getActiveSpan()).toBeUndefined();
    await iterator.return();
    expect(closed).toBe(true);
    const [nested, stream] = exporter.getFinishedSpans();
    expect(stream.attributes[TEABLE_V1_ENGINE_ATTRIBUTE]).toBe('LegacyBoundary.stream');
    expect(nested.parentSpanContext?.spanId).toBe(stream.spanContext().spanId);
  });

  it('ends a fully consumed generator once and shares its span across pulls', async () => {
    const service = new LegacyBoundary();
    const results = [];
    for await (const value of service.stream(() => undefined)) results.push(value);
    expect(results).toEqual([service.result, service.result]);
    const [first, second, stream] = exporter.getFinishedSpans();
    expect(exporter.getFinishedSpans()).toHaveLength(3);
    expect(first.parentSpanContext?.spanId).toBe(stream.spanContext().spanId);
    expect(second.parentSpanContext?.spanId).toBe(stream.spanContext().spanId);
  });

  it('forwards consumer throw and executes generator cleanup under its span', async () => {
    let closed = false;
    const iterator = new LegacyBoundary().stream(() => {
      closed = true;
    });
    await iterator.next();
    const error = new Error('consumer cancelled');
    await expect(iterator.throw(error)).rejects.toBe(error);
    expect(closed).toBe(true);
    expect(exporter.getFinishedSpans()).toHaveLength(2);
    expect(exporter.getFinishedSpans()[1].status.code).toBe(SpanStatusCode.ERROR);
  });

  it('does not create an execution span for an unstarted cancelled generator', async () => {
    const iterator = new LegacyBoundary().stream(() => undefined);
    await iterator.return();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it('records generator rejection and preserves the error', async () => {
    const error = new Error('stream failure');
    await expect(new LegacyBoundary().failedStream(error).next()).rejects.toBe(error);
    expect(exporter.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.ERROR);
  });
});
