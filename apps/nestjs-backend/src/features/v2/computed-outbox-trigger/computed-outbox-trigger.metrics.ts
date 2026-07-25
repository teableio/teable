import { Injectable } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

export type ComputedOutboxConsumeOutcome =
  | 'processed'
  | 'noop'
  | 'deferred'
  | 'parked'
  | 'error'
  | 'invalid';
export type ComputedOutboxPublishOutcome = 'accepted' | 'error' | 'timeout';
export type ComputedOutboxPublishSkipReason = 'no_after_commit' | 'publish_failed';

export type ComputedOutboxRuntimeSnapshot = {
  /** Activity is recorded in memory by this application process, not aggregated cluster-wide. */
  scope: 'process';
  lastPublishAt?: string;
  lastPublishResult?: ComputedOutboxPublishOutcome;
  lastPublishCause?: string;
  lastConsumeAt?: string;
  lastConsumeOutcome?: ComputedOutboxConsumeOutcome;
  lastDeliveryLagMs?: number;
  lastExecutionDurationMs?: number;
};

@Injectable()
export class ComputedOutboxTriggerMetrics {
  private readonly meter = metrics.getMeter('teable-observability');
  private backlogSnapshot: ReadonlyArray<{
    storage: 'default' | 'byodb';
    state: string;
    value: number;
  }> = [];
  private oldestDueAgeSnapshot: ReadonlyArray<{
    storage: 'default' | 'byodb';
    value: number;
  }> = [];
  private queueSnapshot: ReadonlyArray<{ state: string; value: number }> = [];
  private queueWorkers = 0;
  private queueReachable = 0;
  private runtimeSnapshot: ComputedOutboxRuntimeSnapshot = { scope: 'process' };

  private readonly publishTotal = this.meter.createCounter(
    'v2.computed.outbox.wakeup.publish.total',
    { description: 'Computed outbox wake-up publish attempts' }
  );
  private readonly publishSkipTotal = this.meter.createCounter(
    'v2.computed.outbox.wakeup.publish.skip.total',
    {
      description:
        'Computed outbox wake-ups skipped before broker publish (missing after-commit or publish failure swallowed by outbox)',
    }
  );
  private readonly publishDuration = this.meter.createHistogram(
    'v2.computed.outbox.wakeup.publish.duration',
    { description: 'Computed outbox wake-up publish duration', unit: 'ms' }
  );
  private readonly consumeTotal = this.meter.createCounter(
    'v2.computed.outbox.wakeup.consume.total',
    { description: 'Computed outbox wake-up consumption outcomes' }
  );
  private readonly deliveryLag = this.meter.createHistogram(
    'v2.computed.outbox.wakeup.delivery_lag',
    { description: 'Time from wake-up availability to consumer handling', unit: 'ms' }
  );
  private readonly executionDuration = this.meter.createHistogram(
    'v2.computed.outbox.wakeup.execution.duration',
    { description: 'Queue-triggered computed task execution duration', unit: 'ms' }
  );
  private readonly monitorTotal = this.meter.createCounter('v2.computed.outbox.monitor.total', {
    description: 'Read-only computed outbox monitoring snapshot outcomes',
  });

  constructor() {
    this.meter
      .createObservableGauge('v2.computed.outbox.backlog', {
        description: 'Latest computed outbox backlog snapshot',
      })
      .addCallback((observer) => {
        for (const item of this.backlogSnapshot) {
          observer.observe(item.value, { storage: item.storage, state: item.state });
        }
      });
    this.meter
      .createObservableGauge('v2.computed.outbox.oldest_due.age', {
        description: 'Age of the oldest due computed outbox task',
        unit: 'ms',
      })
      .addCallback((observer) => {
        for (const item of this.oldestDueAgeSnapshot) {
          observer.observe(item.value, { storage: item.storage });
        }
      });
    this.meter
      .createObservableGauge('v2.computed.outbox.queue.jobs', {
        description: 'Latest BullMQ computed outbox job counts',
      })
      .addCallback((observer) => {
        for (const item of this.queueSnapshot) {
          observer.observe(item.value, { provider: 'bullmq', state: item.state });
        }
      });
    this.meter
      .createObservableGauge('v2.computed.outbox.queue.workers', {
        description: 'Latest BullMQ computed outbox worker count',
      })
      .addCallback((observer) => {
        observer.observe(this.queueWorkers, { provider: 'bullmq' });
      });
    this.meter
      .createObservableGauge('v2.computed.outbox.queue.reachable', {
        description: 'Whether the BullMQ computed outbox queue was reachable in the latest sample',
      })
      .addCallback((observer) => {
        observer.observe(this.queueReachable, { provider: 'bullmq' });
      });
  }

  recordPublish(result: ComputedOutboxPublishOutcome, cause: string): void {
    this.publishTotal.add(1, { provider: 'bullmq', result, cause });
    this.runtimeSnapshot = {
      ...this.runtimeSnapshot,
      lastPublishAt: new Date().toISOString(),
      lastPublishResult: result,
      lastPublishCause: cause,
    };
  }

  recordPublishSkip(reason: ComputedOutboxPublishSkipReason): void {
    this.publishSkipTotal.add(1, { provider: 'bullmq', reason });
  }

  recordPublishDuration(durationMs: number): void {
    this.publishDuration.record(durationMs, { provider: 'bullmq' });
  }

  recordConsume(outcome: ComputedOutboxConsumeOutcome): void {
    this.consumeTotal.add(1, { provider: 'bullmq', outcome });
    this.runtimeSnapshot = {
      ...this.runtimeSnapshot,
      lastConsumeAt: new Date().toISOString(),
      lastConsumeOutcome: outcome,
    };
  }

  recordDeliveryLag(durationMs: number): void {
    const normalized = Math.max(0, durationMs);
    this.deliveryLag.record(normalized, { provider: 'bullmq' });
    this.runtimeSnapshot = { ...this.runtimeSnapshot, lastDeliveryLagMs: normalized };
  }

  recordExecutionDuration(
    durationMs: number,
    outcome: 'processed' | 'noop' | 'deferred' | 'parked' | 'error'
  ): void {
    this.executionDuration.record(durationMs, { trigger: 'queue', outcome });
    this.runtimeSnapshot = { ...this.runtimeSnapshot, lastExecutionDurationMs: durationMs };
  }

  updateBacklogSnapshot(
    snapshots: ReadonlyArray<{
      storage: 'default' | 'byodb';
      duePending: number;
      scheduledPending: number;
      activeProcessing: number;
      staleProcessing: number;
      dead: number;
      oldestDueAgeMs: number;
    }>
  ): void {
    const aggregated = new Map<'default' | 'byodb', Omit<(typeof snapshots)[number], 'storage'>>();
    for (const snapshot of snapshots) {
      const current = aggregated.get(snapshot.storage) ?? {
        duePending: 0,
        scheduledPending: 0,
        activeProcessing: 0,
        staleProcessing: 0,
        dead: 0,
        oldestDueAgeMs: 0,
      };
      aggregated.set(snapshot.storage, {
        duePending: current.duePending + snapshot.duePending,
        scheduledPending: current.scheduledPending + snapshot.scheduledPending,
        activeProcessing: current.activeProcessing + snapshot.activeProcessing,
        staleProcessing: current.staleProcessing + snapshot.staleProcessing,
        dead: current.dead + snapshot.dead,
        oldestDueAgeMs: Math.max(current.oldestDueAgeMs, snapshot.oldestDueAgeMs),
      });
    }

    const aggregatedSnapshots = [...aggregated.entries()].map(([storage, snapshot]) => ({
      storage,
      ...snapshot,
    }));
    this.backlogSnapshot = aggregatedSnapshots.flatMap((snapshot) => [
      { storage: snapshot.storage, state: 'due_pending', value: snapshot.duePending },
      { storage: snapshot.storage, state: 'scheduled_pending', value: snapshot.scheduledPending },
      {
        storage: snapshot.storage,
        state: 'active_processing',
        value: snapshot.activeProcessing,
      },
      {
        storage: snapshot.storage,
        state: 'stale_processing',
        value: snapshot.staleProcessing,
      },
      { storage: snapshot.storage, state: 'dead', value: snapshot.dead },
    ]);
    this.oldestDueAgeSnapshot = aggregatedSnapshots.map((snapshot) => ({
      storage: snapshot.storage,
      value: snapshot.oldestDueAgeMs,
    }));
  }

  updateQueueSnapshot(snapshot: {
    reachable: boolean;
    workers: number;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    paused: number;
    prioritized: number;
    completed: number;
  }): void {
    this.queueReachable = snapshot.reachable ? 1 : 0;
    this.queueWorkers = snapshot.workers;
    this.queueSnapshot = Object.entries(snapshot)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
      .filter(([state]) => state !== 'workers')
      .map(([state, value]) => ({ state, value }));
  }

  recordMonitor(result: 'success' | 'partial' | 'error'): void {
    this.monitorTotal.add(1, { provider: 'bullmq', result });
  }

  getRuntimeSnapshot(): ComputedOutboxRuntimeSnapshot {
    return { ...this.runtimeSnapshot };
  }
}
