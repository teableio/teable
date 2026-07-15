import { getQueueToken } from '@nestjs/bullmq';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { defaultComputedUpdateOutboxConfig } from '@teable/v2-adapter-table-repository-postgres';
import { Queue, type Job } from 'bullmq';

import {
  ComputedOutboxTriggerConfig,
  type IComputedOutboxTriggerConfig,
} from '../../../configs/computed-outbox-trigger.config';
import type {
  IComputedOutboxMaintenanceSnapshot,
  IComputedOutboxMaintenanceTarget,
} from '../../../global/data-db-client-manager.service';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import { ComputedOutboxTriggerMetrics } from './computed-outbox-trigger.metrics';
import {
  computedOutboxWakeupWireSchema,
  type ComputedOutboxWakeupWire,
} from './computed-outbox-wakeup.wire';
import {
  COMPUTED_OUTBOX_COMPLETED_RETENTION_COUNT,
  COMPUTED_OUTBOX_RECENT_COMPLETED_LIMIT,
  COMPUTED_OUTBOX_WAKEUP_QUEUE,
} from './constants';
import { mapWithConcurrency } from './map-with-concurrency';

type Storage = 'default' | 'byodb';
type HealthStatus = 'healthy' | 'degraded' | 'critical';
type HealthReason =
  | 'queue_unavailable'
  | 'consumer_unavailable'
  | 'failed_jobs'
  | 'dead_letters'
  | 'stale_processing'
  | 'overdue_pending'
  | 'target_unavailable';

type OutboxCounts = IComputedOutboxMaintenanceSnapshot;

export type ComputedOutboxMonitorSnapshot = {
  status: HealthStatus;
  reasons: HealthReason[];
  sampledAt: string;
  config: {
    provider: 'bullmq';
    producerEnabled: boolean;
    consumerEnabled: boolean;
    monitorIntervalMs: number;
  };
  queue: {
    configured: boolean;
    reachable: boolean;
    workers: number | null;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    paused: number;
    prioritized: number;
    completed: number;
    completedRetentionLimit: number;
    recentCompleted: Array<{
      taskId: string;
      baseId: string;
      cause: ComputedOutboxWakeupWire['cause'];
      finishedAt: string;
      processingDurationMs?: number;
      attemptsMade: number;
    }>;
    error?: string;
  };
  outbox: OutboxCounts & {
    targetCount: number;
    unavailableTargetCount: number;
    storage: Array<
      OutboxCounts & {
        storage: Storage;
        targetCount: number;
        unavailableTargetCount: number;
      }
    >;
    error?: string;
  };
  activity: ReturnType<ComputedOutboxTriggerMetrics['getRuntimeSnapshot']>;
};

const emptyCounts = (): OutboxCounts => ({
  duePending: 0,
  scheduledPending: 0,
  activeProcessing: 0,
  staleProcessing: 0,
  dead: 0,
  oldestDueAgeMs: 0,
});

const addCounts = (left: OutboxCounts, right: OutboxCounts): OutboxCounts => ({
  duePending: left.duePending + right.duePending,
  scheduledPending: left.scheduledPending + right.scheduledPending,
  activeProcessing: left.activeProcessing + right.activeProcessing,
  staleProcessing: left.staleProcessing + right.staleProcessing,
  dead: left.dead + right.dead,
  oldestDueAgeMs: Math.max(left.oldestDueAgeMs, right.oldestDueAgeMs),
});

@Injectable()
export class ComputedOutboxMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ComputedOutboxMonitorService.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private currentRefresh: Promise<ComputedOutboxMonitorSnapshot> | undefined;
  private lastSnapshot: ComputedOutboxMonitorSnapshot | undefined;
  private stopped = false;

  constructor(
    @ComputedOutboxTriggerConfig()
    private readonly config: IComputedOutboxTriggerConfig,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly metrics: ComputedOutboxTriggerMetrics,
    @Optional()
    @Inject(getQueueToken(COMPUTED_OUTBOX_WAKEUP_QUEUE))
    private readonly queue?: Queue<ComputedOutboxWakeupWire>
  ) {}

  onApplicationBootstrap(): void {
    void this.refresh().finally(() => this.schedule());
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.currentRefresh;
  }

  /**
   * @param force When true (default for admin GET), always sample instead of
   * returning the background-timer cache. Concurrent callers coalesce on one sample.
   */
  async getOverview(options?: { force?: boolean }): Promise<ComputedOutboxMonitorSnapshot> {
    if (this.currentRefresh) return this.currentRefresh;
    if (options?.force || !this.lastSnapshot) return this.refresh();
    return this.lastSnapshot;
  }

  async refresh(): Promise<ComputedOutboxMonitorSnapshot> {
    if (this.currentRefresh) return this.currentRefresh;
    this.currentRefresh = this.collect()
      .then((snapshot) => {
        this.lastSnapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        this.currentRefresh = undefined;
      });
    return this.currentRefresh;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.refresh().finally(() => this.schedule());
    }, this.config.monitorIntervalMs);
    this.timer.unref?.();
  }

  private async collect(): Promise<ComputedOutboxMonitorSnapshot> {
    const sampledAt = new Date().toISOString();
    const [queue, outbox] = await Promise.all([this.inspectQueue(), this.inspectOutbox()]);
    const reasons = this.healthReasons(queue, outbox);
    const critical = reasons.some((reason) =>
      ['queue_unavailable', 'consumer_unavailable'].includes(reason)
    );
    const status: HealthStatus = critical
      ? 'critical'
      : reasons.length > 0
        ? 'degraded'
        : 'healthy';

    this.metrics.updateQueueSnapshot({
      reachable: queue.reachable,
      workers: queue.workers ?? 0,
      waiting: queue.waiting,
      active: queue.active,
      delayed: queue.delayed,
      failed: queue.failed,
      paused: queue.paused,
      prioritized: queue.prioritized,
      completed: queue.completed,
    });
    this.updateBacklogMetrics(outbox);
    this.metrics.recordMonitor(
      queue.reachable && !outbox.error && outbox.unavailableTargetCount === 0
        ? 'success'
        : queue.reachable || outbox.targetCount > outbox.unavailableTargetCount
          ? 'partial'
          : 'error'
    );

    return {
      status,
      reasons,
      sampledAt,
      config: this.configSnapshot(),
      queue,
      outbox,
      activity: this.metrics.getRuntimeSnapshot(),
    };
  }

  private configSnapshot(): ComputedOutboxMonitorSnapshot['config'] {
    return {
      provider: 'bullmq',
      producerEnabled: this.config.producerEnabled,
      consumerEnabled: this.config.consumerEnabled,
      monitorIntervalMs: this.config.monitorIntervalMs,
    };
  }

  private emptyQueue(configured: boolean): ComputedOutboxMonitorSnapshot['queue'] {
    return {
      configured,
      reachable: false,
      workers: null,
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      paused: 0,
      prioritized: 0,
      completed: 0,
      completedRetentionLimit: COMPUTED_OUTBOX_COMPLETED_RETENTION_COUNT,
      recentCompleted: [],
    };
  }

  private async inspectQueue(): Promise<ComputedOutboxMonitorSnapshot['queue']> {
    if (!this.queue) {
      return { ...this.emptyQueue(false), error: 'BullMQ queue is not configured' };
    }
    try {
      const [counts, workers, completedJobs] = await Promise.all([
        this.queue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
          'paused',
          'prioritized',
          'completed'
        ),
        this.queue.getWorkersCount(),
        this.queue.getCompleted(0, COMPUTED_OUTBOX_RECENT_COMPLETED_LIMIT - 1),
      ]);
      return {
        configured: true,
        reachable: true,
        workers,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        paused: counts.paused ?? 0,
        prioritized: counts.prioritized ?? 0,
        completed: counts.completed ?? 0,
        completedRetentionLimit: COMPUTED_OUTBOX_COMPLETED_RETENTION_COUNT,
        recentCompleted: completedJobs.flatMap((job) => {
          const summary = this.summarizeCompletedJob(job);
          return summary ? [summary] : [];
        }),
      };
    } catch (error) {
      this.logger.warn('computed:outbox:monitor_queue_failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return { ...this.emptyQueue(true), error: 'BullMQ queue is unavailable' };
    }
  }

  private summarizeCompletedJob(
    job?: Job<ComputedOutboxWakeupWire>
  ): ComputedOutboxMonitorSnapshot['queue']['recentCompleted'][number] | null {
    if (!job || !Number.isFinite(job.finishedOn)) return null;
    const wakeupResult = computedOutboxWakeupWireSchema.safeParse(job.data);
    if (!wakeupResult.success) return null;

    const finishedOn = job.finishedOn as number;
    const processingDurationMs = Number.isFinite(job.processedOn)
      ? Math.max(0, finishedOn - (job.processedOn as number))
      : undefined;
    return {
      taskId: wakeupResult.data.taskId,
      baseId: wakeupResult.data.baseId,
      cause: wakeupResult.data.cause,
      finishedAt: new Date(finishedOn).toISOString(),
      ...(processingDurationMs == null ? {} : { processingDurationMs }),
      attemptsMade: Math.max(0, job.attemptsMade ?? 0),
    };
  }

  private emptyOutbox(): ComputedOutboxMonitorSnapshot['outbox'] {
    return {
      ...emptyCounts(),
      targetCount: 0,
      unavailableTargetCount: 0,
      storage: [],
    };
  }

  private async inspectOutbox(): Promise<ComputedOutboxMonitorSnapshot['outbox']> {
    let targets: ReadonlyArray<IComputedOutboxMaintenanceTarget>;
    try {
      targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
    } catch (error) {
      this.logger.warn('computed:outbox:monitor_targets_failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return { ...this.emptyOutbox(), error: 'Data database targets are unavailable' };
    }

    const results = await this.inspectTargets(targets);
    const byStorage = new Map<
      Storage,
      OutboxCounts & { storage: Storage; targetCount: number; unavailableTargetCount: number }
    >([
      [
        'default',
        { storage: 'default', targetCount: 0, unavailableTargetCount: 0, ...emptyCounts() },
      ],
      ['byodb', { storage: 'byodb', targetCount: 0, unavailableTargetCount: 0, ...emptyCounts() }],
    ]);
    let totals = emptyCounts();
    let unavailableTargetCount = 0;
    for (const result of results) {
      const aggregate = byStorage.get(result.target.storage)!;
      aggregate.targetCount += 1;
      if (!result.snapshot) {
        aggregate.unavailableTargetCount += 1;
        unavailableTargetCount += 1;
        continue;
      }
      Object.assign(aggregate, addCounts(aggregate, result.snapshot));
      totals = addCounts(totals, result.snapshot);
    }

    return {
      ...totals,
      targetCount: targets.length,
      unavailableTargetCount,
      storage: [...byStorage.values()].filter((item) => item.targetCount > 0),
      ...(unavailableTargetCount > 0
        ? { error: `${unavailableTargetCount} data database target(s) unavailable` }
        : {}),
    };
  }

  private async inspectTargets(targets: ReadonlyArray<IComputedOutboxMaintenanceTarget>) {
    return mapWithConcurrency(targets, this.config.monitorConcurrency, async (target) => {
      try {
        const snapshot = await this.dataDbClientManager.inspectComputedOutboxMaintenanceTarget(
          target,
          defaultComputedUpdateOutboxConfig.processingLeaseMs
        );
        return { target, snapshot };
      } catch (error) {
        this.logger.warn('computed:outbox:monitor_target_failed', {
          storage: target.storage,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        return { target };
      }
    });
  }

  private healthReasons(
    queue: ComputedOutboxMonitorSnapshot['queue'],
    outbox: ComputedOutboxMonitorSnapshot['outbox']
  ): HealthReason[] {
    const reasons: HealthReason[] = [];
    if (!queue.reachable) reasons.push('queue_unavailable');
    // Worker count is cluster-wide; surface zero consumers even on producer-only replicas.
    if (queue.reachable && queue.workers === 0) reasons.push('consumer_unavailable');
    if (queue.failed > 0) reasons.push('failed_jobs');
    reasons.push(...this.outboxHealthReasons(outbox));
    return reasons;
  }

  private outboxHealthReasons(outbox: ComputedOutboxMonitorSnapshot['outbox']): HealthReason[] {
    const reasons: HealthReason[] = [];
    if (outbox.dead > 0) reasons.push('dead_letters');
    if (outbox.staleProcessing > 0) reasons.push('stale_processing');
    if (outbox.duePending > 0 && outbox.oldestDueAgeMs > this.config.monitorIntervalMs * 2) {
      reasons.push('overdue_pending');
    }
    if (outbox.unavailableTargetCount > 0 || outbox.error) reasons.push('target_unavailable');
    return reasons;
  }

  private updateBacklogMetrics(outbox: ComputedOutboxMonitorSnapshot['outbox']): void {
    this.metrics.updateBacklogSnapshot(
      outbox.storage.map((snapshot) => ({
        storage: snapshot.storage,
        duePending: snapshot.duePending,
        scheduledPending: snapshot.scheduledPending,
        activeProcessing: snapshot.activeProcessing,
        staleProcessing: snapshot.staleProcessing,
        dead: snapshot.dead,
        oldestDueAgeMs: snapshot.oldestDueAgeMs,
      }))
    );
  }
}
