import { metrics } from '@opentelemetry/api';

// Lives alongside RealtimeMetricsService so every realtime.* metric definition
// is discoverable in one folder. Kept standalone (not a method on the
// @Injectable service) on purpose, same as query-poll-skip-metrics: the
// permessage-deflate extension is built once at module load and handed to
// sockjs, so it can never inject a Nest provider.
//
// recordCompressionFrame fires on every websocket frame — the same order of
// magnitude as skipPoll — so frames are observed through aggregated counters
// only; per-frame logging at this rate is not acceptable.
//
// Cardinality budget, using the accounting in tracing.ts (SigNoz bills per
// sample; a histogram with N boundaries costs N+4 series per label set):
//
//   negotiation.total   3 results               ->  3
//   sessions.active     no labels               ->  1
//   bytes.uncompressed  2 directions            ->  2
//   bytes.compressed    2 directions            ->  2
//   duration            4 boundaries, no labels ->  9
//                                                  ── 17 samples per pod
//
// Every label here is closed-set. Nothing derived from a user, table, space or
// connection is ever attached — that is what turns a metric into a bill.
const meter = metrics.getMeter('teable-observability');

const negotiationTotal = meter.createCounter('realtime.compression.negotiation.total', {
  description:
    'WebSocket connections by permessage-deflate outcome. `offer_missing` means the ' +
    'Sec-WebSocket-Extensions header did not reach this pod — normally a proxy, load ' +
    'balancer or CDN in front stripped it. `not_applicable` is the xhr-streaming ' +
    'fallback, which has no websocket extensions to negotiate.',
});

const uncompressedBytes = meter.createCounter('realtime.compression.bytes.uncompressed', {
  description: 'Frame bytes before deflate (outbound) or after inflate (inbound)',
  unit: 'By',
});

const compressedBytes = meter.createCounter('realtime.compression.bytes.compressed', {
  description: 'Frame bytes on the wire. Divide uncompressed by this for the live ratio.',
  unit: 'By',
});

// Outbound only, and deliberately unlabeled. Inbound is inflate over small
// ShareDB ops and would double the series count to restate what outbound
// already shows. Four boundaries are enough for the one question this answers:
// normal (sub-millisecond) versus libuv threadpool contention (tens of ms).
// Its `count` also stands in for a frames-sent counter, so there isn't one.
const outboundDuration = meter.createHistogram('realtime.compression.duration', {
  description:
    'Wall time per outbound frame through zlib. Node runs deflate on the libuv ' +
    'threadpool, so sustained growth here means threadpool contention rather than ' +
    'slow compression.',
  unit: 'ms',
  advice: { explicitBucketBoundaries: [0.5, 5, 25, 100] },
});

// Deliberately a gauge rather than a cumulative count of sessions created: this
// is the multiplier for the memory budget. Each live session pins a deflate and
// an inflate context, measured at ~250 KiB per connection with the settings in
// ws/sockjs-options.ts, so `sessions.active * 250 KiB` is the RAM compression is
// costing right now. realtime.connections.active cannot stand in for it — that
// counts xhr-streaming connections too, and those hold no zlib contexts.
const sessionsActive = meter.createUpDownCounter('realtime.compression.sessions.active', {
  description:
    'Live permessage-deflate sessions, each holding a deflate + inflate context. ' +
    'Multiply by the per-connection cost to get compression memory.',
});

export type ICompressionNegotiation = 'negotiated' | 'offer_missing' | 'not_applicable';
export type ICompressionDirection = 'outbound' | 'inbound';

export interface ICompressionSnapshot {
  /** Sessions opened since boot. Process-local only; not exported. */
  sessionsCreated: number;
  /** Sessions currently holding zlib contexts — the memory multiplier. */
  sessionsActive: number;
  outbound: { frames: number; uncompressedBytes: number; compressedBytes: number };
  inbound: { frames: number; uncompressedBytes: number; compressedBytes: number };
}

// Process-local mirror of the counters above. OTEL counters are write-only, and
// a running total is worth having on hand for a one-off check without a
// dashboard query.
const local: ICompressionSnapshot = {
  sessionsCreated: 0,
  sessionsActive: 0,
  outbound: { frames: 0, uncompressedBytes: 0, compressedBytes: 0 },
  inbound: { frames: 0, uncompressedBytes: 0, compressedBytes: 0 },
};

export const getCompressionSnapshot = (): ICompressionSnapshot => ({
  sessionsCreated: local.sessionsCreated,
  sessionsActive: local.sessionsActive,
  outbound: { ...local.outbound },
  inbound: { ...local.inbound },
});

/**
 * Classifies whether compression is actually reaching this pod.
 *
 * Every browser in current use offers permessage-deflate on a websocket
 * upgrade, so `offer_missing` on the websocket transport is the signal that
 * something in front of the pod removed `Sec-WebSocket-Extensions`.
 */
export const recordCompressionNegotiation = (
  transport: string,
  extensionsHeader?: string
): ICompressionNegotiation => {
  const result: ICompressionNegotiation =
    transport !== 'websocket'
      ? 'not_applicable'
      : extensionsHeader?.includes('permessage-deflate')
        ? 'negotiated'
        : 'offer_missing';

  // `transport` is intentionally not a label: `result` already separates the
  // websocket cases from the fallback, so adding it would only widen the label
  // set the day another transport is enabled.
  negotiationTotal.add(1, { result });
  return result;
};

/**
 * @param plain  bytes before deflate (outbound) or after inflate (inbound)
 * @param wire   bytes as they cross the socket
 * @param durationMs omitted for inbound, which is not timed
 */
export const recordCompressionFrame = (
  direction: ICompressionDirection,
  plain: number,
  wire: number,
  durationMs?: number
): void => {
  const bucket = direction === 'outbound' ? local.outbound : local.inbound;
  bucket.frames += 1;
  bucket.uncompressedBytes += plain;
  bucket.compressedBytes += wire;

  uncompressedBytes.add(plain, { direction });
  compressedBytes.add(wire, { direction });
  if (durationMs !== undefined) outboundDuration.record(durationMs);
};

export const recordCompressionSessionOpen = (): void => {
  local.sessionsCreated += 1;
  local.sessionsActive += 1;
  sessionsActive.add(1);
};

export const recordCompressionSessionClose = (): void => {
  local.sessionsActive -= 1;
  sessionsActive.add(-1);
};
