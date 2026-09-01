/* eslint-disable @typescript-eslint/naming-convention */
import type { SpanContext } from '@opentelemetry/api';
import { context, SpanKind, SpanStatusCode, trace, TraceFlags } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan, SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ATTR_HTTP_RESPONSE_STATUS_CODE } from '@opentelemetry/semantic-conventions';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSmartSpanProcessor,
  getTraceDecision,
  hashTraceId,
  isDroppedPrismaSpan,
  isErrorSpan,
  isPriorityTraceSpan,
  EXPORTED_TTL_MS,
  GLOBAL_CAP,
  LIVE_TTL_MS,
  PENDING_TTL_MS,
  PER_TRACE_CAP,
  SETTLED_LINGER_MS,
  TOMBSTONE_CAP,
  TRACE_EXPORT_SPAN_CAP,
} from './tracing-span-export';

type ExportCallback = Parameters<SpanExporter['export']>[1];

class FakeExporter implements SpanExporter {
  readonly spans: ReadableSpan[] = [];

  export(spans: ReadableSpan[], resultCallback: ExportCallback): void {
    this.spans.push(...spans);
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

/** Find traceIds whose deterministic hash decision matches `sampled` at ratio 0.1 */
const findTraceIds = (count: number, sampled: boolean): string[] => {
  const ids: string[] = [];
  for (let i = 1; ids.length < count && i < 1_000_000; i++) {
    const id = i.toString(16).padStart(32, '0');
    if (getTraceDecision(id, 0.1) === sampled) ids.push(id);
  }
  return ids;
};

const [SAMPLED_TRACE_ID] = findTraceIds(1, true);
const [UNSAMPLED_TRACE_ID] = findTraceIds(1, false);

let spanSeq = 0;

interface FakeSpanOptions {
  traceId?: string;
  name?: string;
  kind?: SpanKind;
  durationMs?: number;
  statusCode?: SpanStatusCode;
  attributes?: Record<string, string | number>;
  /** 'local' = in-process parent, 'remote' = extracted parent (nested SERVER), 'none' = true root */
  parent?: 'local' | 'remote' | 'none';
}

const makeSpan = (options: FakeSpanOptions = {}): ReadableSpan => {
  const {
    traceId = UNSAMPLED_TRACE_ID,
    name = `span-${spanSeq}`,
    kind = SpanKind.INTERNAL,
    durationMs = 5,
    statusCode = SpanStatusCode.UNSET,
    attributes = {},
    parent = 'local',
  } = options;
  const spanId = (++spanSeq).toString(16).padStart(16, '0');
  const parentSpanContext: SpanContext | undefined =
    parent === 'none'
      ? undefined
      : {
          traceId,
          spanId: 'f'.repeat(16),
          traceFlags: TraceFlags.SAMPLED,
          isRemote: parent === 'remote',
        };
  return {
    name,
    kind,
    spanContext: () => ({ traceId, spanId, traceFlags: TraceFlags.SAMPLED }),
    parentSpanContext,
    startTime: [0, 0],
    endTime: [0, 0],
    status: { code: statusCode },
    attributes,
    links: [],
    events: [],
    duration: [Math.floor(durationMs / 1000), Math.round((durationMs % 1000) * 1_000_000)],
    ended: true,
    resource: { attributes: {}, asyncAttributesPending: false },
    instrumentationScope: { name: 'test' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan;
};

const DEFAULT_OPTIONS = {
  exportRatio: 0.1,
  maxQueueSize: 20_000,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
  priorityScheduledDelayMillis: 1000,
  exportTimeoutMillis: 30_000,
  maxExportedSpansPerTrace: TRACE_EXPORT_SPAN_CAP,
};

const createProcessor = (overrides: Partial<typeof DEFAULT_OPTIONS> = {}) => {
  const batchExporter = new FakeExporter();
  const priorityExporter = new FakeExporter();
  const processor = createSmartSpanProcessor(batchExporter, priorityExporter, {
    ...DEFAULT_OPTIONS,
    ...overrides,
  });
  return { processor, batchExporter, priorityExporter };
};

type ProcessorSpan = Parameters<SpanProcessor['onStart']>[0];

const startSpan = (processor: SpanProcessor, span: ReadableSpan): void =>
  processor.onStart(span as unknown as ProcessorSpan, context.active());

/** onStart + onEnd for a span that opens and closes with no other activity in between */
const runSpan = (processor: SpanProcessor, span: ReadableSpan): void => {
  startSpan(processor, span);
  processor.onEnd(span);
};

const names = (exporter: FakeExporter): string[] => exporter.spans.map((s) => s.name);

afterEach(() => {
  vi.useRealTimers();
});

describe('hashTraceId / getTraceDecision', () => {
  it('is deterministic and bounded to [0, 10000)', () => {
    const id = 'abcdef01234567890abcdef012345678';
    expect(hashTraceId(id)).toBe(hashTraceId(id));
    expect(hashTraceId(id)).toBeGreaterThanOrEqual(0);
    expect(hashTraceId(id)).toBeLessThan(10000);
  });

  it('respects ratio boundaries', () => {
    const id = 'abcdef01234567890abcdef012345678';
    expect(getTraceDecision(id, 0)).toBe(false);
    expect(getTraceDecision(id, 1)).toBe(true);
  });
});

describe('span predicates', () => {
  it('detects error and 5xx spans; slowness is not an error', () => {
    expect(isErrorSpan(makeSpan({ statusCode: SpanStatusCode.ERROR }))).toBe(true);
    expect(isErrorSpan(makeSpan({ attributes: { [ATTR_HTTP_RESPONSE_STATUS_CODE]: 502 } }))).toBe(
      true
    );
    expect(isErrorSpan(makeSpan({ durationMs: 2000 }))).toBe(false);
  });

  it('keeps the prisma spine and drops the rest', () => {
    expect(isDroppedPrismaSpan(makeSpan({ name: 'prisma:client:serialize' }))).toBe(true);
    expect(isDroppedPrismaSpan(makeSpan({ name: 'prisma:engine:db_query' }))).toBe(false);
    expect(isDroppedPrismaSpan(makeSpan({ name: 'pg.query' }))).toBe(false);
  });

  it('recognizes priority spans', () => {
    expect(isPriorityTraceSpan(makeSpan({ kind: SpanKind.SERVER }))).toBe(true);
    expect(
      isPriorityTraceSpan(makeSpan({ attributes: { 'teable.route.full': 'GET /api/x' } }))
    ).toBe(true);
    expect(isPriorityTraceSpan(makeSpan({}))).toBe(false);
  });

  it('does not promote the nest handler span that mirrors the SERVER span', () => {
    // NestInstrumentation sets http.route + the interceptor used to add nest.*; both
    // made a second always-exported copy of every request.
    expect(isPriorityTraceSpan(makeSpan({ attributes: { 'http.route': '/api/x' } }))).toBe(false);
    expect(
      isPriorityTraceSpan(makeSpan({ attributes: { 'nest.controller': 'A', 'nest.handler': 'b' } }))
    ).toBe(false);
  });
});

describe('createSmartSpanProcessor', () => {
  it('exports every span of a sampled trace', async () => {
    const { processor, batchExporter, priorityExporter } = createProcessor();
    const root = makeSpan({
      traceId: SAMPLED_TRACE_ID,
      name: 'root',
      kind: SpanKind.SERVER,
      parent: 'none',
    });
    startSpan(processor, root);
    runSpan(processor, makeSpan({ traceId: SAMPLED_TRACE_ID, name: 'db-call' }));
    runSpan(
      processor,
      makeSpan({
        traceId: SAMPLED_TRACE_ID,
        name: 'route',
        attributes: { 'teable.route.full': 'GET /x' },
      })
    );
    processor.onEnd(root);
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['db-call']);
    expect(names(priorityExporter)).toEqual(['route', 'root']);
  });

  it('unsampled fast trace: only priority spans exported, buffer lingers after settle', async () => {
    const { processor, batchExporter, priorityExporter } = createProcessor();
    const root = makeSpan({ name: 'root', kind: SpanKind.SERVER, parent: 'none' });
    startSpan(processor, root);
    runSpan(processor, makeSpan({ name: 'child-a' }));
    runSpan(processor, makeSpan({ name: 'child-b' }));
    processor.onEnd(root);
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual([]);
    expect(names(priorityExporter)).toEqual(['root']);

    // within the settle linger, a late error span still promotes the full trace
    runSpan(processor, makeSpan({ name: 'late-error', statusCode: SpanStatusCode.ERROR }));
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['child-a', 'child-b', 'late-error']);
  });

  it('discards a settled remote-parent trace after the linger, not the 5-minute TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const { processor, batchExporter, priorityExporter } = createProcessor();
    const entry = makeSpan({ name: 'entry-server', kind: SpanKind.SERVER, parent: 'remote' });
    startSpan(processor, entry);
    runSpan(processor, makeSpan({ name: 'child' }));
    processor.onEnd(entry);
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual([]);
    expect(names(priorityExporter)).toEqual(['entry-server']);

    vi.setSystemTime(start + SETTLED_LINGER_MS + 60_000);
    runSpan(processor, makeSpan({ traceId: findTraceIds(2, false)[1], name: 'other' }));

    // the linger expired: promotion has nothing left to flush
    runSpan(processor, makeSpan({ name: 'late-error', statusCode: SpanStatusCode.ERROR }));
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['late-error']);
  });

  it('async tail work re-opens the trace and is exported on promotion', async () => {
    const { processor, batchExporter } = createProcessor();
    runSpan(processor, makeSpan({ name: 'root', kind: SpanKind.SERVER, parent: 'none' }));
    // fire-and-forget work after the response: buffered through the linger
    runSpan(processor, makeSpan({ name: 'tail' }));
    runSpan(processor, makeSpan({ name: 'error', statusCode: SpanStatusCode.ERROR }));
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['tail', 'error']);
  });

  it('slow spans follow the trace-level export ratio instead of promoting', async () => {
    const { processor, batchExporter, priorityExporter } = createProcessor();
    const root = makeSpan({ name: 'root', kind: SpanKind.SERVER, parent: 'none' });
    startSpan(processor, root);
    runSpan(processor, makeSpan({ name: 'early' }));
    runSpan(processor, makeSpan({ name: 'slow-child', durationMs: 6000 }));
    processor.onEnd(root);
    await processor.forceFlush();
    // unsampled trace: the slow child is buffered and discarded like any other span
    expect(names(batchExporter)).toEqual([]);
    expect(names(priorityExporter)).toEqual(['root']);

    // sampled trace: the slow child exports via the ratio decision, not promotion
    const { processor: p2, batchExporter: b2 } = createProcessor();
    runSpan(p2, makeSpan({ traceId: SAMPLED_TRACE_ID, name: 'slow-child', durationMs: 6000 }));
    await p2.forceFlush();
    expect(names(b2)).toEqual(['slow-child']);
  });

  it('flushes the buffer when only the root span errors', async () => {
    const { processor, batchExporter, priorityExporter } = createProcessor();
    const root = makeSpan({
      name: 'error-root',
      kind: SpanKind.SERVER,
      parent: 'none',
      statusCode: SpanStatusCode.ERROR,
    });
    startSpan(processor, root);
    runSpan(processor, makeSpan({ name: 'mid-1' }));
    runSpan(processor, makeSpan({ name: 'mid-2' }));
    processor.onEnd(root);
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['mid-1', 'mid-2']);
    expect(names(priorityExporter)).toEqual(['error-root']);
  });

  it('promotes on error status and on http 5xx', async () => {
    for (const attrs of [
      { statusCode: SpanStatusCode.ERROR },
      { attributes: { [ATTR_HTTP_RESPONSE_STATUS_CODE]: 500 } },
    ] as FakeSpanOptions[]) {
      const { processor, batchExporter } = createProcessor();
      const trigger = makeSpan({ name: 'trigger', ...attrs });
      startSpan(processor, trigger);
      runSpan(processor, makeSpan({ name: 'buffered' }));
      processor.onEnd(trigger);
      await processor.forceFlush();
      expect(names(batchExporter)).toEqual(['buffered', 'trigger']);
    }
  });

  it('does not re-export priority spans on promotion', async () => {
    const { processor, batchExporter, priorityExporter } = createProcessor();
    const errorChild = makeSpan({ name: 'error-child', statusCode: SpanStatusCode.ERROR });
    startSpan(processor, errorChild);
    runSpan(processor, makeSpan({ name: 'buffered' }));
    runSpan(
      processor,
      makeSpan({ name: 'handler', attributes: { 'teable.route.full': 'GET /api/chat' } })
    );
    processor.onEnd(errorChild);
    await processor.forceFlush();
    expect(names(priorityExporter)).toEqual(['handler']);
    expect(names(batchExporter)).toEqual(['buffered', 'error-child']);
  });

  it('does not finalize the buffer when a nested remote-parent SERVER span ends mid-trace', async () => {
    const { processor, batchExporter, priorityExporter } = createProcessor();
    const outerRoot = makeSpan({
      name: 'outer-root',
      kind: SpanKind.SERVER,
      parent: 'none',
      statusCode: SpanStatusCode.ERROR,
    });
    startSpan(processor, outerRoot);
    runSpan(processor, makeSpan({ name: 'mid-1' }));
    // inner SERVER span of a proxied request: has a remote parent, is NOT the last live span
    runSpan(processor, makeSpan({ name: 'inner-server', kind: SpanKind.SERVER, parent: 'remote' }));
    runSpan(processor, makeSpan({ name: 'mid-2' }));
    processor.onEnd(outerRoot);
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['mid-1', 'mid-2']);
    expect(names(priorityExporter)).toEqual(['inner-server', 'outer-root']);
  });

  it('trims non-spine prisma spans', async () => {
    const { processor, batchExporter } = createProcessor();
    // sampled trace: non-spine prisma dropped, spine kept
    runSpan(processor, makeSpan({ traceId: SAMPLED_TRACE_ID, name: 'prisma:client:serialize' }));
    runSpan(processor, makeSpan({ traceId: SAMPLED_TRACE_ID, name: 'prisma:engine:db_query' }));
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['prisma:engine:db_query']);

    // unsampled trace: non-spine prisma is never buffered, so promotion does not flush it
    const { processor: p2, batchExporter: b2 } = createProcessor();
    const errorSpan = makeSpan({ name: 'error', statusCode: SpanStatusCode.ERROR });
    startSpan(p2, errorSpan);
    runSpan(p2, makeSpan({ name: 'prisma:client:serialize' }));
    runSpan(p2, makeSpan({ name: 'kept' }));
    p2.onEnd(errorSpan);
    await p2.forceFlush();
    expect(names(b2)).toEqual(['kept', 'error']);

    // slow non-spine prisma is trimmed like any other, even in a sampled trace
    const { processor: p3, batchExporter: b3 } = createProcessor();
    runSpan(
      p3,
      makeSpan({ traceId: SAMPLED_TRACE_ID, name: 'prisma:client:serialize', durationMs: 2000 })
    );
    await p3.forceFlush();
    expect(names(b3)).toEqual([]);
  });

  it('exportRatio >= 1.0 exports everything immediately without lifecycle tracking', async () => {
    const { processor, batchExporter, priorityExporter } = createProcessor({ exportRatio: 1.0 });
    // no onStart on purpose: the ratio >= 1 path needs no live-span bookkeeping
    processor.onEnd(makeSpan({ name: 'child' }));
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['child']);
    processor.onEnd(makeSpan({ name: 'root', kind: SpanKind.SERVER, parent: 'none' }));
    await processor.forceFlush();
    expect(names(priorityExporter)).toEqual(['root']);
  });

  it('caps the per-trace buffer, dropping the oldest span', async () => {
    const { processor, batchExporter } = createProcessor();
    const root = makeSpan({ name: 'root', kind: SpanKind.SERVER, parent: 'none' });
    startSpan(processor, root);
    for (let i = 0; i <= PER_TRACE_CAP; i++) {
      runSpan(processor, makeSpan({ name: `b${i}` }));
    }
    runSpan(processor, makeSpan({ name: 'trigger', statusCode: SpanStatusCode.ERROR }));
    await processor.forceFlush();
    const exportedNames = names(batchExporter);
    expect(exportedNames).toHaveLength(PER_TRACE_CAP + 1);
    expect(exportedNames[0]).toBe('b1');
    expect(exportedNames).not.toContain('b0');
    expect(exportedNames[exportedNames.length - 1]).toBe('trigger');
  });

  it('evicts the oldest trace entirely when the global cap is exceeded', async () => {
    const traceIds = findTraceIds(21, false);
    const { processor, batchExporter } = createProcessor();
    // one never-ended span per trace keeps every trace in flight while buffering
    startSpan(processor, makeSpan({ traceId: traceIds[0], name: 'hold-0' }));
    for (let i = 0; i < 100; i++) {
      runSpan(processor, makeSpan({ traceId: traceIds[0], name: `a${i}` }));
    }
    const perTrace = GLOBAL_CAP / 20;
    for (let t = 1; t <= 20; t++) {
      startSpan(processor, makeSpan({ traceId: traceIds[t], name: `hold-${t}` }));
      for (let i = 0; i < perTrace; i++) {
        runSpan(processor, makeSpan({ traceId: traceIds[t], name: `t${t}-${i}` }));
      }
    }
    // trace 0 (oldest) was evicted: promoting it flushes nothing
    runSpan(
      processor,
      makeSpan({ traceId: traceIds[0], name: 'err-a', statusCode: SpanStatusCode.ERROR })
    );
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['err-a']);

    // trace 1 survived intact
    runSpan(
      processor,
      makeSpan({ traceId: traceIds[1], name: 'err-t1', statusCode: SpanStatusCode.ERROR })
    );
    await processor.forceFlush();
    expect(batchExporter.spans).toHaveLength(1 + perTrace + 1);
    expect(names(batchExporter)).toContain('t1-0');
    expect(names(batchExporter)[batchExporter.spans.length - 1]).toBe('err-t1');
  });

  it('cap eviction spends settled linger buffers before in-flight ones', async () => {
    const traceIds = findTraceIds(22, false);
    const { processor, batchExporter } = createProcessor();
    // oldest holder: in-flight trace A
    startSpan(processor, makeSpan({ traceId: traceIds[0], name: 'hold-a' }));
    for (let i = 0; i < 100; i++) {
      runSpan(processor, makeSpan({ traceId: traceIds[0], name: `a${i}` }));
    }
    // trace S: buffered, then settled into its linger window
    const holdS = makeSpan({ traceId: traceIds[1], name: 'hold-s' });
    startSpan(processor, holdS);
    for (let i = 0; i < 100; i++) {
      runSpan(processor, makeSpan({ traceId: traceIds[1], name: `s${i}` }));
    }
    processor.onEnd(holdS);
    // fill to overflow with in-flight traces
    const perTrace = (GLOBAL_CAP - 100) / 20;
    for (let t = 2; t <= 21; t++) {
      startSpan(processor, makeSpan({ traceId: traceIds[t], name: `hold-${t}` }));
      for (let i = 0; i < perTrace; i++) {
        runSpan(processor, makeSpan({ traceId: traceIds[t], name: `t${t}-${i}` }));
      }
    }
    // S (settled) was evicted even though A is the older holder
    runSpan(
      processor,
      makeSpan({ traceId: traceIds[1], name: 'err-s', statusCode: SpanStatusCode.ERROR })
    );
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['err-s']);

    // A (in-flight) kept its buffer
    runSpan(
      processor,
      makeSpan({ traceId: traceIds[0], name: 'err-a', statusCode: SpanStatusCode.ERROR })
    );
    await processor.forceFlush();
    expect(names(batchExporter)).toContain('a0');
    expect(names(batchExporter)).toContain('a99');
  });

  it('keeps the buffer of a live trace past the pending TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const traceIds = findTraceIds(2, false);
    const { processor, batchExporter } = createProcessor();
    startSpan(processor, makeSpan({ traceId: traceIds[0], name: 'hold' }));
    runSpan(processor, makeSpan({ traceId: traceIds[0], name: 'buffered' }));

    vi.setSystemTime(start + PENDING_TTL_MS + 60_000);
    // any span end past the cleanup gate triggers the sweep
    runSpan(processor, makeSpan({ traceId: traceIds[1], name: 'other' }));

    // the open 'hold' span keeps the trace live, so promotion still flushes
    runSpan(
      processor,
      makeSpan({ traceId: traceIds[0], name: 'err', statusCode: SpanStatusCode.ERROR })
    );
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['buffered', 'err']);
  });

  it('evicts leaked traces and their buffers after the live TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const traceIds = findTraceIds(2, false);
    const { processor, batchExporter } = createProcessor();
    startSpan(processor, makeSpan({ traceId: traceIds[0], name: 'leaked' }));
    runSpan(processor, makeSpan({ traceId: traceIds[0], name: 'buffered' }));

    vi.setSystemTime(start + LIVE_TTL_MS + 60_000);
    runSpan(processor, makeSpan({ traceId: traceIds[1], name: 'other' }));

    runSpan(
      processor,
      makeSpan({ traceId: traceIds[0], name: 'err', statusCode: SpanStatusCode.ERROR })
    );
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['err']);
  });

  it('expires untracked pending buffers after the pending TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const traceIds = findTraceIds(2, false);
    const { processor, batchExporter } = createProcessor();
    // onEnd without onStart: the span predates processor attach, no live entry
    processor.onEnd(makeSpan({ traceId: traceIds[0], name: 'orphan' }));

    vi.setSystemTime(start + PENDING_TTL_MS + 60_000);
    runSpan(processor, makeSpan({ traceId: traceIds[1], name: 'other' }));

    runSpan(
      processor,
      makeSpan({ traceId: traceIds[0], name: 'err', statusCode: SpanStatusCode.ERROR })
    );
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['err']);
  });

  it('expires exported marks after the exported TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const traceIds = findTraceIds(2, false);
    const { processor, batchExporter } = createProcessor();
    runSpan(
      processor,
      makeSpan({ traceId: traceIds[0], name: 'err', statusCode: SpanStatusCode.ERROR })
    );
    runSpan(processor, makeSpan({ traceId: traceIds[0], name: 'follow-1' }));

    vi.setSystemTime(start + EXPORTED_TTL_MS + 60_000);
    runSpan(processor, makeSpan({ traceId: traceIds[1], name: 'other' }));

    // the exported mark expired: this span is buffered, then discarded when the trace settles
    runSpan(processor, makeSpan({ traceId: traceIds[0], name: 'follow-2' }));
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['err', 'follow-1']);
  });

  it('caps promoted tombstones, evicting the oldest first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const traceIds = findTraceIds(TOMBSTONE_CAP + 2, false);
    const { processor, batchExporter } = createProcessor();
    for (let i = 0; i <= TOMBSTONE_CAP; i++) {
      runSpan(
        processor,
        makeSpan({ traceId: traceIds[i], name: `err-${i}`, statusCode: SpanStatusCode.ERROR })
      );
    }

    vi.setSystemTime(start + 60_000);
    runSpan(processor, makeSpan({ traceId: traceIds[TOMBSTONE_CAP + 1], name: 'other' }));

    // oldest tombstone evicted: its late span no longer follows the promotion
    runSpan(processor, makeSpan({ traceId: traceIds[0], name: 'follow-oldest' }));
    // a recent tombstone survives: its late span still exports
    runSpan(processor, makeSpan({ traceId: traceIds[1], name: 'follow-recent' }));
    await processor.forceFlush();
    expect(names(batchExporter)).not.toContain('follow-oldest');
    expect(names(batchExporter)).toContain('follow-recent');
  });

  it('truncates a runaway trace past the per-trace export cap', async () => {
    const { processor, batchExporter, priorityExporter } = createProcessor({
      maxExportedSpansPerTrace: 3,
    });
    for (let i = 0; i < 6; i++) {
      runSpan(processor, makeSpan({ traceId: SAMPLED_TRACE_ID, name: `detail-${i}` }));
    }
    // priority and error spans stay exempt so APM stats and failures survive
    runSpan(
      processor,
      makeSpan({
        traceId: SAMPLED_TRACE_ID,
        name: 'route',
        attributes: { 'teable.route.full': 'GET /x' },
      })
    );
    runSpan(
      processor,
      makeSpan({ traceId: SAMPLED_TRACE_ID, name: 'boom', statusCode: SpanStatusCode.ERROR })
    );
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['detail-0', 'detail-1', 'detail-2', 'boom']);
    expect(names(priorityExporter)).toEqual(['route']);
  });

  it('keeps counting across settled gaps, so a leaked trace cannot reset the cap', async () => {
    const { processor, batchExporter } = createProcessor({ maxExportedSpansPerTrace: 2 });
    // each span opens and closes alone: the trace settles between every one
    runSpan(processor, makeSpan({ traceId: SAMPLED_TRACE_ID, name: 'a' }));
    runSpan(processor, makeSpan({ traceId: SAMPLED_TRACE_ID, name: 'b' }));
    runSpan(processor, makeSpan({ traceId: SAMPLED_TRACE_ID, name: 'dropped' }));
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['a', 'b']);
  });

  it('reclaims the export tally once a quiet trace is swept', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const [runaway, other] = findTraceIds(2, true);
    const { processor, batchExporter } = createProcessor({ maxExportedSpansPerTrace: 2 });
    runSpan(processor, makeSpan({ traceId: runaway, name: 'a' }));
    runSpan(processor, makeSpan({ traceId: runaway, name: 'b' }));
    runSpan(processor, makeSpan({ traceId: runaway, name: 'dropped' }));

    // silence past the exported TTL, then unrelated traffic drives the sweep
    vi.setSystemTime(start + EXPORTED_TTL_MS + 60_000);
    runSpan(processor, makeSpan({ traceId: other, name: 'other' }));

    runSpan(processor, makeSpan({ traceId: runaway, name: 'after-sweep' }));
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['a', 'b', 'other', 'after-sweep']);
  });

  it('drains the pending buffer on shutdown', async () => {
    const { processor, batchExporter } = createProcessor();
    const root = makeSpan({ name: 'root', kind: SpanKind.SERVER, parent: 'none' });
    startSpan(processor, root);
    runSpan(processor, makeSpan({ name: 'in-flight' }));
    await processor.shutdown();
    expect(names(batchExporter)).toEqual(['in-flight']);
  });
});

describe('integration with real SDK spans', () => {
  it('promotes an errored trace in full and discards a slow-but-clean one', async () => {
    const { processor, batchExporter, priorityExporter } = createProcessor({ exportRatio: 0 });
    const provider = new BasicTracerProvider({ spanProcessors: [processor] });
    const tracer = provider.getTracer('test');
    const t0 = 1_700_000_000_000;

    // errored request: the buffered child flushes when the SERVER root ends with ERROR
    const root = tracer.startSpan('error-root', {
      kind: SpanKind.SERVER,
      startTime: t0,
      root: true,
    });
    const ctx = trace.setSpan(context.active(), root);
    const fastChild = tracer.startSpan('fast-child', { startTime: t0 }, ctx);
    fastChild.end(t0 + 10);
    root.setStatus({ code: SpanStatusCode.ERROR });
    root.end(t0 + 100);
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['fast-child']);
    expect(names(priorityExporter)).toEqual(['error-root']);

    // slow-but-clean request: follows the ratio (0 here), children are discarded
    const root2 = tracer.startSpan('slow-root', {
      kind: SpanKind.SERVER,
      startTime: t0,
      root: true,
    });
    const ctx2 = trace.setSpan(context.active(), root2);
    const slowChild = tracer.startSpan('slow-child', { startTime: t0 }, ctx2);
    slowChild.end(t0 + 6000);
    root2.end(t0 + 10_600);
    await processor.forceFlush();
    expect(names(batchExporter)).toEqual(['fast-child']);
    expect(names(priorityExporter)).toEqual(['error-root', 'slow-root']);

    await provider.shutdown();
  });
});
