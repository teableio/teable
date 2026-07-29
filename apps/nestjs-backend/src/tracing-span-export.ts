/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Smart span export with trace-coherent tail decision.
 *
 * Sampling stays at 100%; this module decides at export time which spans
 * reach the backend:
 * - error / 5xx spans always export and promote their whole trace:
 *   buffered spans are flushed, later spans export directly
 * - traces picked by the traceId hash (OTEL_EXPORT_RATIO) export in full
 * - other traces export only priority spans (SERVER/route/handler, keeps APM
 *   stats accurate); the rest are buffered and discarded once the trace's
 *   live-span refcount drops to zero without a promotion
 *
 * Refcounting (onStart/onEnd) instead of watching for a parentless root span
 * handles remote-parent entry spans and post-response async work uniformly.
 * Per-trace bookkeeping lives in TraceStore below, which documents the record
 * shapes and memory bounds. Priority spans batch on a short delay; shutdown
 * drains undecided buffers (they belong to interrupted requests).
 */
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan, SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ATTR_HTTP_RESPONSE_STATUS_CODE } from '@opentelemetry/semantic-conventions';

export const PER_TRACE_CAP = 512;
export const GLOBAL_CAP = 10_000;
export const PENDING_TTL_MS = 5 * 60 * 1000;
export const LIVE_TTL_MS = 30 * 60 * 1000;
export const EXPORTED_TTL_MS = 10 * 60 * 1000;
export const SETTLED_LINGER_MS = 10_000;
export const TOMBSTONE_CAP = 10_000;
const CLEANUP_INTERVAL_MS = 30_000;

export const hashTraceId = (traceId: string): number => {
  // FNV-1a hash for better distribution
  let hash = 2166136261;
  for (let i = 0; i < traceId.length; i++) {
    hash ^= traceId.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash % 10000;
};

export const getTraceDecision = (traceId: string, exportRatio: number): boolean =>
  hashTraceId(traceId) < exportRatio * 10000;

// Prisma emits ~11 spans per query. Keep only the spine
// (operation -> engine:query -> db_query) so the surviving db_query is never
// orphaned (renders as a "Missing Span"); drop the rest.
const PRISMA_SPINE_SPANS = new Set([
  'prisma:client:operation',
  'prisma:engine:query',
  'prisma:engine:db_query',
]);

export const isDroppedPrismaSpan = (span: ReadableSpan): boolean =>
  span.name.startsWith('prisma:') && !PRISMA_SPINE_SPANS.has(span.name);

export const isPriorityTraceSpan = (span: ReadableSpan): boolean => {
  const attributes = span.attributes;
  return (
    span.kind === SpanKind.SERVER ||
    typeof attributes['teable.route.full'] === 'string' ||
    typeof attributes['http.route'] === 'string' ||
    (typeof attributes['nest.controller'] === 'string' &&
      typeof attributes['nest.handler'] === 'string')
  );
};

export const isErrorSpan = (span: ReadableSpan): boolean => {
  if (span.status.code === SpanStatusCode.ERROR) return true;

  const httpStatusCode = span.attributes[ATTR_HTTP_RESPONSE_STATUS_CODE];
  return typeof httpStatusCode === 'number' && httpStatusCode >= 500;
};

export interface ISmartSpanProcessorOptions {
  exportRatio: number;
  maxQueueSize: number;
  maxExportBatchSize: number;
  scheduledDelayMillis: number;
  /** Short delay for priority spans; APM stats lag by at most this much. */
  priorityScheduledDelayMillis: number;
  exportTimeoutMillis: number;
}

interface ITraceState {
  liveSpans: number;
  spans: ReadableSpan[];
  promotedUntilMs: number;
  settledAtMs: number;
  lastTouchedMs: number;
}

/**
 * Per-trace bookkeeping. The `traces` Map is the single source of truth; a
 * record is in exactly one shape, derived from its fields:
 * - active (liveSpans > 0): buffer held for possible promotion; reclaimed as
 *   leaked only after LIVE_TTL_MS without span activity
 * - settled (refcount reached zero unpromoted): buffer retained for
 *   SETTLED_LINGER_MS so fire-and-forget work that resumes the trace can
 *   still promote it complete
 * - orphan (buffered spans that predate onStart tracking): reclaimed after
 *   PENDING_TTL_MS
 * - tombstone (promoted and settled): kept until promotedUntilMs so late
 *   spans keep exporting; capped at TOMBSTONE_CAP
 *
 * Buffers are capped per trace (PER_TRACE_CAP) and globally (GLOBAL_CAP).
 * `bufferHolders`/`settledHolders` are insertion-ordered views used only to
 * pick eviction order in O(1); `drainBuffer` is their single removal point,
 * so a stale index entry can at worst delay one eviction.
 */
class TraceStore {
  private readonly traces = new Map<string, ITraceState>();
  private readonly bufferHolders = new Set<string>();
  private readonly settledHolders = new Set<string>();
  private bufferedSpanCount = 0;

  getOrCreate(traceId: string, nowMs: number): ITraceState {
    let trace = this.traces.get(traceId);
    if (!trace) {
      trace = { liveSpans: 0, spans: [], promotedUntilMs: 0, settledAtMs: 0, lastTouchedMs: nowMs };
      this.traces.set(traceId, trace);
    }
    return trace;
  }

  /** Empties a trace's buffer and returns the spans. The only index-removal point. */
  drainBuffer(traceId: string, trace: ITraceState): ReadableSpan[] {
    const spans = trace.spans;
    this.bufferedSpanCount -= spans.length;
    trace.spans = [];
    this.bufferHolders.delete(traceId);
    this.settledHolders.delete(traceId);
    return spans;
  }

  removeIfInert(traceId: string, trace: ITraceState, nowMs: number): void {
    if (trace.liveSpans === 0 && trace.spans.length === 0 && trace.promotedUntilMs <= nowMs) {
      this.traces.delete(traceId);
    }
  }

  recordStart(traceId: string, nowMs: number): void {
    const trace = this.getOrCreate(traceId, nowMs);
    trace.liveSpans++;
    if (trace.settledAtMs !== 0) {
      trace.settledAtMs = 0;
      this.settledHolders.delete(traceId);
    }
    trace.lastTouchedMs = nowMs;
  }

  settle(traceId: string, trace: ITraceState, nowMs: number): void {
    // liveSpans 0 here means this span was never tracked by onStart
    // (it predates processor attach); the orphan TTL owns its buffer.
    if (trace.liveSpans === 0) return;
    trace.liveSpans--;
    if (trace.liveSpans > 0) {
      trace.lastTouchedMs = nowMs;
      return;
    }
    // Completed without promotion: keep the buffer through a short linger so
    // fire-and-forget work that resumes the trace can still promote it whole.
    trace.settledAtMs = nowMs;
    if (trace.spans.length > 0) this.settledHolders.add(traceId);
  }

  buffer(span: ReadableSpan, traceId: string, trace: ITraceState, nowMs: number): void {
    if (trace.spans.length >= PER_TRACE_CAP) {
      trace.spans.shift();
      this.bufferedSpanCount--;
    }
    trace.spans.push(span);
    trace.lastTouchedMs = nowMs;
    this.bufferedSpanCount++;
    this.bufferHolders.add(traceId);
    if (trace.settledAtMs > 0) this.settledHolders.add(traceId);
    if (this.bufferedSpanCount > GLOBAL_CAP) this.evictOverCap(nowMs);
  }

  private evictOverCap(nowMs: number): void {
    // Settled linger buffers are already scheduled for discard: spend them
    // first so cap pressure never evicts an in-flight trace's buffer early.
    for (const traceId of this.settledHolders) {
      if (this.bufferedSpanCount <= GLOBAL_CAP) break;
      const trace = this.traces.get(traceId);
      // A resumed trace stays indexed until its buffer drops; skip it here.
      if (!trace || trace.settledAtMs === 0) {
        this.settledHolders.delete(traceId);
        continue;
      }
      this.drainBuffer(traceId, trace);
      this.removeIfInert(traceId, trace, nowMs);
    }
    // Still over: evict whole oldest buffers (insertion order).
    for (const traceId of this.bufferHolders) {
      if (this.bufferedSpanCount <= GLOBAL_CAP) break;
      const trace = this.traces.get(traceId);
      if (!trace) {
        this.bufferHolders.delete(traceId);
        continue;
      }
      this.drainBuffer(traceId, trace);
      this.removeIfInert(traceId, trace, nowMs);
    }
  }

  sweep(nowMs: number): void {
    let tombstones = 0;
    for (const [traceId, trace] of this.traces) {
      if (this.reapIfExpired(traceId, trace, nowMs)) tombstones++;
    }
    if (tombstones > TOMBSTONE_CAP) this.evictTombstones(tombstones - TOMBSTONE_CAP, nowMs);
  }

  /** Applies the shape's TTL to one record; returns true for a live tombstone. */
  private reapIfExpired(traceId: string, trace: ITraceState, nowMs: number): boolean {
    if (trace.liveSpans > 0) {
      // Presumed leaked (a span started but never ended) after LIVE_TTL_MS.
      if (nowMs - trace.lastTouchedMs > LIVE_TTL_MS) {
        this.drainBuffer(traceId, trace);
        this.traces.delete(traceId);
      }
      return false;
    }
    if (trace.spans.length > 0) {
      // Settled buffers linger briefly for async resumption; orphan buffers
      // (spans that predate onStart tracking) wait out the pending TTL.
      const sinceMs = trace.settledAtMs > 0 ? trace.settledAtMs : trace.lastTouchedMs;
      const ttlMs = trace.settledAtMs > 0 ? SETTLED_LINGER_MS : PENDING_TTL_MS;
      if (nowMs - sinceMs > ttlMs) {
        this.drainBuffer(traceId, trace);
        this.traces.delete(traceId);
      }
      return false;
    }
    if (trace.promotedUntilMs <= nowMs) {
      this.traces.delete(traceId);
      return false;
    }
    return true;
  }

  // Evict oldest surplus tombstones; their late spans just fall back to
  // the hash decision instead of following the promotion.
  private evictTombstones(excess: number, nowMs: number): void {
    for (const [traceId, trace] of this.traces) {
      if (excess === 0) break;
      if (trace.liveSpans === 0 && trace.spans.length === 0 && trace.promotedUntilMs > nowMs) {
        this.traces.delete(traceId);
        excess--;
      }
    }
  }

  /** Empties every buffer and resets the store; returns the drained spans. */
  drainAll(): ReadableSpan[] {
    const drained: ReadableSpan[] = [];
    for (const trace of this.traces.values()) {
      drained.push(...trace.spans);
    }
    this.traces.clear();
    this.bufferHolders.clear();
    this.settledHolders.clear();
    this.bufferedSpanCount = 0;
    return drained;
  }
}

export const createSmartSpanProcessor = (
  batchExporter: SpanExporter,
  priorityExporter: SpanExporter,
  options: ISmartSpanProcessorOptions
): SpanProcessor => {
  const { exportRatio } = options;
  const batchProcessor = new BatchSpanProcessor(batchExporter, {
    maxQueueSize: options.maxQueueSize,
    maxExportBatchSize: options.maxExportBatchSize,
    scheduledDelayMillis: options.scheduledDelayMillis,
    exportTimeoutMillis: options.exportTimeoutMillis,
  });
  const priorityProcessor = new BatchSpanProcessor(priorityExporter, {
    // Priority spans are the APM baseline; 4x queue headroom means a slow or
    // restarting collector drops detail spans well before request-rate data.
    maxQueueSize: options.maxQueueSize * 4,
    maxExportBatchSize: options.maxExportBatchSize,
    scheduledDelayMillis: options.priorityScheduledDelayMillis,
    exportTimeoutMillis: options.exportTimeoutMillis,
  });

  const route = (span: ReadableSpan): void => {
    if (isPriorityTraceSpan(span)) {
      priorityProcessor.onEnd(span);
    } else {
      batchProcessor.onEnd(span);
    }
  };

  const forwardStart: SpanProcessor['onStart'] = (span, parentContext) => {
    priorityProcessor.onStart(span, parentContext);
    batchProcessor.onStart(span, parentContext);
  };

  const flushProcessors = (): Promise<void> =>
    Promise.all([priorityProcessor.forceFlush(), batchProcessor.forceFlush()]).then(
      () => undefined
    );

  const shutdownProcessors = (): Promise<void> =>
    Promise.all([priorityProcessor.shutdown(), batchProcessor.shutdown()]).then(() => undefined);

  // Full export: every span routes directly, no lifecycle tracking needed.
  if (exportRatio >= 1.0) {
    return {
      onStart: forwardStart,
      onEnd: (span: ReadableSpan) => {
        if (isDroppedPrismaSpan(span) && !isErrorSpan(span)) return;
        route(span);
      },
      shutdown: shutdownProcessors,
      forceFlush: flushProcessors,
    };
  }

  const store = new TraceStore();
  let lastCleanupMs = Date.now();

  const cleanup = (nowMs: number): void => {
    if (nowMs - lastCleanupMs < CLEANUP_INTERVAL_MS) return;
    lastCleanupMs = nowMs;
    store.sweep(nowMs);
  };

  // Backstop for idle processes: onEnd also triggers cleanup, but with no
  // traffic nothing would ever reclaim the store. unref'd so it cannot hold
  // the process open.
  const cleanupTimer = setInterval(() => cleanup(Date.now()), CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();

  const promote = (traceId: string, trace: ITraceState, nowMs: number): void => {
    trace.promotedUntilMs = nowMs + EXPORTED_TTL_MS;
    for (const buffered of store.drainBuffer(traceId, trace)) {
      batchProcessor.onEnd(buffered);
    }
  };

  const decide = (span: ReadableSpan, trace: ITraceState, traceId: string, nowMs: number): void => {
    if (isErrorSpan(span)) {
      promote(traceId, trace, nowMs);
      route(span);
      return;
    }

    if (isDroppedPrismaSpan(span)) return;

    if (trace.promotedUntilMs > nowMs) {
      route(span);
      return;
    }

    // Deterministic per traceId, so picked traces need no stored state.
    if (getTraceDecision(traceId, exportRatio)) {
      route(span);
      return;
    }

    // Priority spans are never buffered, so promotion cannot duplicate them.
    if (isPriorityTraceSpan(span)) {
      priorityProcessor.onEnd(span);
    } else {
      store.buffer(span, traceId, trace, nowMs);
    }
  };

  return {
    onStart: (span, parentContext) => {
      forwardStart(span, parentContext);
      store.recordStart(span.spanContext().traceId, Date.now());
    },
    onEnd: (span: ReadableSpan) => {
      const nowMs = Date.now();
      cleanup(nowMs);
      const traceId = span.spanContext().traceId;
      const trace = store.getOrCreate(traceId, nowMs);
      decide(span, trace, traceId, nowMs);
      store.settle(traceId, trace, nowMs);
      store.removeIfInert(traceId, trace, nowMs);
    },
    shutdown: () => {
      clearInterval(cleanupTimer);
      for (const buffered of store.drainAll()) {
        batchProcessor.onEnd(buffered);
      }
      return shutdownProcessors();
    },
    forceFlush: flushProcessors,
  };
};
