import type { IExecutionContext } from '@teable/v2-core';
import { nanoid } from 'nanoid';

import { TableQueryObservationWindow } from './domain';
import type { TableQueryObservationBatchSink, TableQueryObservationPublisher } from './ports';

export type BufferedTableQueryObservationPublisherOptions = {
  readonly writerId?: string;
  readonly flushIntervalMs?: number;
  readonly maxPendingKeys?: number;
  readonly batchSize?: number;
};

type PendingObservation = {
  readonly context: IExecutionContext;
  readonly observation: TableQueryObservationWindow;
};

const defaultFlushIntervalMs = 10_000;
const defaultMaxPendingKeys = 1_000;
const defaultBatchSize = 100;
const processWriterId = `tqo_${nanoid(16)}`;

export class BufferedTableQueryObservationPublisher implements TableQueryObservationPublisher {
  private readonly writerId: string;
  private readonly flushIntervalMs: number;
  private readonly maxPendingKeys: number;
  private readonly batchSize: number;
  private readonly pending = new Map<string, PendingObservation>();

  private flushTimer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly batchSink: TableQueryObservationBatchSink,
    options: BufferedTableQueryObservationPublisherOptions = {}
  ) {
    this.writerId = options.writerId ?? processWriterId;
    this.flushIntervalMs = positiveInteger(
      'flushIntervalMs',
      options.flushIntervalMs ?? defaultFlushIntervalMs
    );
    this.maxPendingKeys = positiveInteger(
      'maxPendingKeys',
      options.maxPendingKeys ?? defaultMaxPendingKeys
    );
    this.batchSize = positiveInteger('batchSize', options.batchSize ?? defaultBatchSize);
  }

  publish(context: IExecutionContext, observation: TableQueryObservationWindow): void {
    if (this.stopped) return;

    const key = observationKey(observation);
    const current = this.pending.get(key);
    if (current) {
      this.pending.set(key, {
        context,
        observation: mergeObservations(current.observation, observation),
      });
    } else {
      if (this.pending.size >= this.maxPendingKeys) this.evictColdestPending();
      this.pending.set(key, { context, observation });
    }

    if (!this.inFlight) this.scheduleFlush();
  }

  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.clearTimer();
    if (this.inFlight) {
      return this.inFlight.then(() => {
        if (this.stopped || this.pending.size === 0) return;
        return this.flush();
      });
    }

    const drain = Promise.resolve().then(() => this.drainPending());
    const settled = drain.finally(() => {
      if (this.inFlight === settled) this.inFlight = undefined;
      if (!this.stopped && this.pending.size > 0) this.scheduleFlush();
    });
    this.inFlight = settled;
    return settled;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
    this.pending.clear();
  }

  private evictColdestPending(): void {
    let coldestKey: string | undefined;
    let coldestRequestCount = Number.POSITIVE_INFINITY;
    for (const [key, pending] of this.pending) {
      const requestCount = pending.observation.snapshot().requestCount;
      if (requestCount < coldestRequestCount) {
        coldestKey = key;
        coldestRequestCount = requestCount;
      }
    }
    if (coldestKey) this.pending.delete(coldestKey);
  }

  private scheduleFlush(): void {
    if (this.stopped || this.flushTimer || this.pending.size === 0) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  private clearTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }

  private async drainPending(): Promise<void> {
    while (!this.stopped && this.pending.size > 0) {
      const batch = this.takeBatch();
      if (!batch) return;

      try {
        const result = await this.batchSink.recordBatch(batch.context, {
          writerId: this.writerId,
          observations: batch.observations,
        });
        if (result.isErr()) return;
      } catch {
        return;
      }
    }
  }

  private takeBatch():
    | {
        readonly context: IExecutionContext;
        readonly observations: ReadonlyArray<TableQueryObservationWindow>;
      }
    | undefined {
    const observations: TableQueryObservationWindow[] = [];
    let context: IExecutionContext | undefined;

    for (const [key, pending] of this.pending) {
      context ??= pending.context;
      observations.push(pending.observation);
      this.pending.delete(key);
      if (observations.length >= this.batchSize) break;
    }

    return context ? { context, observations } : undefined;
  }
}

const observationKey = (observation: TableQueryObservationWindow): string => {
  const snapshot = observation.snapshot();
  return [
    snapshot.tableId,
    observation.shape().queryKind(),
    snapshot.shapeHash,
    snapshot.windowStart.toISOString(),
  ].join(':');
};

const mergeObservations = (
  current: TableQueryObservationWindow,
  next: TableQueryObservationWindow
): TableQueryObservationWindow => {
  const currentSnapshot = current.snapshot();
  const nextSnapshot = next.snapshot();
  const totalDbDurationMs =
    currentSnapshot.totalDbDurationMs == null && nextSnapshot.totalDbDurationMs == null
      ? undefined
      : (currentSnapshot.totalDbDurationMs ?? 0) + (nextSnapshot.totalDbDurationMs ?? 0);
  const maxDbDurationMs =
    currentSnapshot.maxDbDurationMs == null && nextSnapshot.maxDbDurationMs == null
      ? undefined
      : Math.max(currentSnapshot.maxDbDurationMs ?? 0, nextSnapshot.maxDbDurationMs ?? 0);

  return TableQueryObservationWindow.create({
    spaceId: nextSnapshot.spaceId ?? currentSnapshot.spaceId,
    baseId: currentSnapshot.baseId,
    tableId: currentSnapshot.tableId,
    windowStart: currentSnapshot.windowStart,
    windowSizeSeconds: currentSnapshot.windowSizeSeconds,
    shapeHash: currentSnapshot.shapeHash,
    shape: current.shape(),
    requestCount: currentSnapshot.requestCount + nextSnapshot.requestCount,
    slowCount: currentSnapshot.slowCount + nextSnapshot.slowCount,
    timeoutCount: currentSnapshot.timeoutCount + nextSnapshot.timeoutCount,
    dbErrorCount: currentSnapshot.dbErrorCount + nextSnapshot.dbErrorCount,
    totalDurationMs: currentSnapshot.totalDurationMs + nextSnapshot.totalDurationMs,
    maxDurationMs: Math.max(currentSnapshot.maxDurationMs, nextSnapshot.maxDurationMs),
    totalDbDurationMs,
    maxDbDurationMs,
    sqlDiagnostics: nextSnapshot.sqlDiagnostics?.length
      ? nextSnapshot.sqlDiagnostics
      : currentSnapshot.sqlDiagnostics,
  })._unsafeUnwrap();
};

const positiveInteger = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
};
