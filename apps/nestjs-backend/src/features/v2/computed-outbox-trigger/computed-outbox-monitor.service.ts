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
import { mapWithConcurrency } from '../../../utils/map-with-concurrency';
import {
  COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MAX,
  COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MIN,
  ComputedOutboxClaimConcurrencyService,
  type ComputedOutboxClaimConcurrencyOverride,
} from './computed-outbox-claim-concurrency.service';
import { ComputedOutboxTriggerMetrics } from './computed-outbox-trigger.metrics';
import {
  computedOutboxWakeupWireSchema,
  type ComputedOutboxWakeupWire,
} from './computed-outbox-wakeup.wire';
import {
  COMPUTED_OUTBOX_WORKER_CONCURRENCY_MAX,
  COMPUTED_OUTBOX_WORKER_CONCURRENCY_MIN,
  ComputedOutboxWorkerConcurrencyService,
} from './computed-outbox-worker-concurrency.service';
import {
  COMPUTED_OUTBOX_COMPLETED_RETENTION_COUNT,
  COMPUTED_OUTBOX_FAILED_RETENTION_COUNT,
  COMPUTED_OUTBOX_JOB_SCAN_LIMIT,
  COMPUTED_OUTBOX_RECENT_COMPLETED_LIMIT,
  COMPUTED_OUTBOX_RECENT_FAILED_LIMIT,
  COMPUTED_OUTBOX_WAKEUP_QUEUE,
} from './constants';

type Storage = 'default' | 'byodb';
type HealthStatus = 'healthy' | 'degraded' | 'critical';
type HealthReason =
  | 'queue_unavailable'
  | 'queue_paused'
  | 'consumer_unavailable'
  | 'failed_jobs'
  | 'dead_letters'
  | 'stale_processing'
  | 'overdue_pending'
  | 'paused_backlog'
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
    /** BullMQ global queue pause switch — distinct from database-backed scope pauses. */
    isPaused: boolean;
    workers: number | null;
    /** Per-process worker concurrency: env default plus the runtime Redis override. */
    workerConcurrency: {
      processDefault: number;
      override: number | null;
      min: number;
      max: number;
    };
    /** Outbox claim caps (per base / per seed table): env defaults plus the runtime override. */
    claimConcurrency: {
      processDefault: { perBase: number; perSeedTable: number };
      override: ComputedOutboxClaimConcurrencyOverride;
      min: number;
      max: number;
    };
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    paused: number;
    prioritized: number;
    completed: number;
    completedRetentionLimit: number;
    failedRetentionLimit: number;
    recentCompleted: Array<{
      taskId: string;
      baseId: string;
      cause: ComputedOutboxWakeupWire['cause'];
      finishedAt: string;
      processingDurationMs?: number;
      attemptsMade: number;
    }>;
    recentFailed: Array<{
      taskId: string;
      baseId: string;
      cause?: ComputedOutboxWakeupWire['cause'];
      failedAt: string;
      failedReason: string | null;
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
  pauses: {
    activeScopeCount: number;
    pausedPending: number;
    oldestPausedAgeMs: number;
  };
  activity: ReturnType<ComputedOutboxTriggerMetrics['getRuntimeSnapshot']>;
};

export type ComputedOutboxQueueJobState =
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'failed'
  | 'paused'
  | 'prioritized'
  | 'completed';

export type ComputedOutboxQueueJobOutcome = 'processed' | 'noop' | 'deferred' | 'parked';

const QUEUE_JOB_OUTCOMES: ReadonlySet<string> = new Set([
  'processed',
  'noop',
  'deferred',
  'parked',
]);

export type ComputedOutboxQueueJobSummary = {
  taskId: string;
  baseId: string;
  cause?: ComputedOutboxWakeupWire['cause'];
  state: ComputedOutboxQueueJobState;
  attemptsMade: number;
  createdAt: string;
  availableAt?: string;
  emittedAt?: string;
  scheduledFor?: string;
  startedAt?: string;
  finishedAt?: string;
  processingDurationMs?: number;
  failedReason?: string | null;
  /** Handler outcome retained as the job return value (completed jobs only). */
  outcome?: ComputedOutboxQueueJobOutcome;
};

export type ComputedOutboxQueueJobScanResult = {
  jobs: ComputedOutboxQueueJobSummary[];
  scan: Array<{
    state: ComputedOutboxQueueJobState;
    scanned: number;
    truncated: boolean;
    /**
     * Orphaned Redis references: the job id is still in the state's set (so it
     * counts toward getJobCounts and the state tiles) but the job data hash is
     * gone, leaving nothing to list. Only present when > 0.
     */
    missing?: number;
  }>;
  error?: string;
};

// Orphan sweep floor: scanning the failed set touches every retained id, so
// each process only re-checks after this long even though refresh runs more
// often. Multiple replicas sweeping concurrently is harmless (ZREM idempotent).
const ORPHANED_FAILED_SWEEP_MIN_INTERVAL_MS = 5 * 60_000;

const emptyCounts = (): OutboxCounts => ({
  duePending: 0,
  scheduledPending: 0,
  pausedPending: 0,
  activeProcessing: 0,
  staleProcessing: 0,
  dead: 0,
  anomalyGroups: 0,
  oldestDueAgeMs: 0,
  oldestPausedAgeMs: 0,
  activePauseScopeCount: 0,
});

const addCounts = (left: OutboxCounts, right: OutboxCounts): OutboxCounts => ({
  duePending: left.duePending + right.duePending,
  scheduledPending: left.scheduledPending + right.scheduledPending,
  pausedPending: left.pausedPending + right.pausedPending,
  activeProcessing: left.activeProcessing + right.activeProcessing,
  staleProcessing: left.staleProcessing + right.staleProcessing,
  dead: left.dead + right.dead,
  anomalyGroups: (left.anomalyGroups ?? 0) + (right.anomalyGroups ?? 0),
  oldestDueAgeMs: Math.max(left.oldestDueAgeMs, right.oldestDueAgeMs),
  oldestPausedAgeMs: Math.max(left.oldestPausedAgeMs, right.oldestPausedAgeMs),
  activePauseScopeCount: left.activePauseScopeCount + right.activePauseScopeCount,
});

@Injectable()
export class ComputedOutboxMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ComputedOutboxMonitorService.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private currentRefresh: Promise<ComputedOutboxMonitorSnapshot> | undefined;
  private lastSnapshot: ComputedOutboxMonitorSnapshot | undefined;
  private stopped = false;
  private lastOrphanSweepAt = 0;

  constructor(
    @ComputedOutboxTriggerConfig()
    private readonly config: IComputedOutboxTriggerConfig,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly metrics: ComputedOutboxTriggerMetrics,
    @Optional()
    @Inject(getQueueToken(COMPUTED_OUTBOX_WAKEUP_QUEUE))
    private readonly queue?: Queue<ComputedOutboxWakeupWire>,
    @Optional()
    private readonly workerConcurrency?: ComputedOutboxWorkerConcurrencyService,
    @Optional()
    private readonly claimConcurrency?: ComputedOutboxClaimConcurrencyService
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

  /**
   * Drop retained failed wake-up jobs from Redis. Failed jobs are attempt-level
   * history; the durable ledger (and its dead letters) is untouched, so nothing
   * recoverable is lost.
   */
  async cleanFailedJobs(): Promise<{ cleaned: number }> {
    if (!this.queue) return { cleaned: 0 };
    let cleaned = 0;
    // queue.clean removes at most `limit` jobs per call; loop until drained.
    for (;;) {
      const removed = await this.queue.clean(0, 1000, 'failed');
      cleaned += removed.length;
      if (removed.length < 1000) break;
    }
    void this.refresh().catch(() => undefined);
    return { cleaned };
  }

  /**
   * Per-state scan cap for the admin job browser. Terminal states are capped
   * at their BullMQ retention count so every retained job is visible and the
   * list agrees with the state-tile counts; live states (waiting/active/
   * delayed/paused) are unbounded in Redis, so they keep a page-sized cap and
   * report `truncated` during extreme backlogs.
   *
   * Failed/completed Redis sets cannot exceed their retention, so filling the
   * scan cap still means we covered every retained job — do not flag those as
   * truncated (that warning made the Failed tile look incomplete).
   */
  private queueJobScanCap(state: ComputedOutboxQueueJobState): number {
    switch (state) {
      case 'failed':
        return COMPUTED_OUTBOX_FAILED_RETENTION_COUNT;
      case 'completed':
        return COMPUTED_OUTBOX_COMPLETED_RETENTION_COUNT;
      default:
        return COMPUTED_OUTBOX_JOB_SCAN_LIMIT;
    }
  }

  /**
   * Scan retained BullMQ jobs per state for the admin job browser. Each state
   * is fetched in COMPUTED_OUTBOX_JOB_SCAN_LIMIT-sized pages up to its scan
   * cap to bound single Redis round-trips; `truncated` marks live states whose
   * retained set exceeds the page-sized cap.
   */
  async listQueueJobs(
    states: ReadonlyArray<ComputedOutboxQueueJobState>
  ): Promise<ComputedOutboxQueueJobScanResult> {
    if (!this.queue) {
      return { jobs: [], scan: [], error: 'BullMQ queue is not configured' };
    }
    const uniqueStates = [...new Set(states)];
    try {
      const perState = await Promise.all(
        uniqueStates.map(async (state) => {
          const cap = this.queueJobScanCap(state);
          const jobs: Job<ComputedOutboxWakeupWire>[] = [];
          for (let offset = 0; offset < cap; offset += COMPUTED_OUTBOX_JOB_SCAN_LIMIT) {
            const end = Math.min(offset + COMPUTED_OUTBOX_JOB_SCAN_LIMIT, cap) - 1;
            const page = await this.queue!.getJobs([state], offset, end);
            jobs.push(...page);
            if (page.length < end - offset + 1) break;
          }
          return {
            state,
            jobs,
            truncated: state !== 'failed' && state !== 'completed' && jobs.length >= cap,
          };
        })
      );
      const jobs: ComputedOutboxQueueJobSummary[] = [];
      const scan: ComputedOutboxQueueJobScanResult['scan'] = [];
      for (const { state, jobs: stateJobs, truncated } of perState) {
        const { summaries, missing } = this.summarizeScannedState(state, stateJobs);
        jobs.push(...summaries);
        scan.push({
          state,
          scanned: summaries.length,
          truncated,
          ...(missing > 0 ? { missing } : {}),
        });
      }
      return { jobs, scan };
    } catch (error) {
      this.logger.warn('computed:outbox:list_queue_jobs_failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return { jobs: [], scan: [], error: 'BullMQ queue is unavailable' };
    }
  }

  private summarizeScannedState(
    state: ComputedOutboxQueueJobState,
    stateJobs: ReadonlyArray<Job<ComputedOutboxWakeupWire> | undefined>
  ): { summaries: ComputedOutboxQueueJobSummary[]; missing: number } {
    const summaries: ComputedOutboxQueueJobSummary[] = [];
    let missing = 0;
    for (const job of stateJobs) {
      // getJobs resolves each id in the state's set to its data hash and yields
      // undefined for ids whose hash is gone (e.g. after Redis data loss).
      // Those orphaned references still inflate getJobCounts, so count them
      // instead of silently swallowing the tile/list mismatch.
      if (!job || !Number.isFinite(job.timestamp)) {
        missing += 1;
        continue;
      }
      const summary = this.summarizeQueueJob(job, state);
      if (summary) summaries.push(summary);
    }
    return { summaries, missing };
  }

  private summarizeQueueJob(
    job: Job<ComputedOutboxWakeupWire>,
    state: ComputedOutboxQueueJobState
  ): ComputedOutboxQueueJobSummary | null {
    const wakeupResult = computedOutboxWakeupWireSchema.safeParse(job.data);
    // Malformed payloads stay visible for failed jobs (mirrors the failed
    // history) but are dropped elsewhere: without wire data there is nothing
    // actionable to show for a job that is still flowing.
    if (!wakeupResult.success && state !== 'failed') return null;

    const createdAt = new Date(job.timestamp).toISOString();
    const summary: ComputedOutboxQueueJobSummary = wakeupResult.success
      ? {
          taskId: wakeupResult.data.taskId,
          baseId: wakeupResult.data.baseId,
          cause: wakeupResult.data.cause,
          state,
          attemptsMade: Math.max(0, job.attemptsMade ?? 0),
          createdAt,
          availableAt: wakeupResult.data.availableAt,
          emittedAt: wakeupResult.data.emittedAt,
        }
      : {
          taskId: String(job.id ?? 'unknown'),
          baseId: 'unknown',
          state,
          attemptsMade: Math.max(0, job.attemptsMade ?? 0),
          createdAt,
        };
    if (state === 'completed') {
      const returnStatus = (job.returnvalue as { status?: unknown } | null | undefined)?.status;
      if (typeof returnStatus === 'string' && QUEUE_JOB_OUTCOMES.has(returnStatus)) {
        summary.outcome = returnStatus as ComputedOutboxQueueJobOutcome;
      }
    }
    this.applyQueueJobStateTimestamps(summary, job, state);
    return summary;
  }

  private applyQueueJobStateTimestamps(
    summary: ComputedOutboxQueueJobSummary,
    job: Job<ComputedOutboxWakeupWire>,
    state: ComputedOutboxQueueJobState
  ): void {
    const processedOn = Number.isFinite(job.processedOn) ? (job.processedOn as number) : undefined;
    const finishedOn = Number.isFinite(job.finishedOn) ? (job.finishedOn as number) : undefined;
    if (state === 'delayed') {
      summary.scheduledFor = new Date(job.timestamp + Math.max(0, job.delay ?? 0)).toISOString();
    }
    if (
      processedOn != null &&
      (state === 'active' || state === 'completed' || state === 'failed')
    ) {
      summary.startedAt = new Date(processedOn).toISOString();
    }
    if (finishedOn != null && (state === 'completed' || state === 'failed')) {
      summary.finishedAt = new Date(finishedOn).toISOString();
      if (processedOn != null) {
        summary.processingDurationMs = Math.max(0, finishedOn - processedOn);
      }
    }
    if (state === 'failed') {
      summary.failedReason = this.truncatedFailedReason(job);
    }
  }

  private truncatedFailedReason(job: Job<ComputedOutboxWakeupWire>): string | null {
    return typeof job.failedReason === 'string' && job.failedReason.length > 0
      ? job.failedReason.slice(0, 2000)
      : null;
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
      ['queue_unavailable', 'queue_paused', 'consumer_unavailable'].includes(reason)
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
      pauses: {
        activeScopeCount: outbox.activePauseScopeCount,
        pausedPending: outbox.pausedPending,
        oldestPausedAgeMs: outbox.oldestPausedAgeMs,
      },
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

  private queueWorkerConcurrency(
    override: number | null
  ): ComputedOutboxMonitorSnapshot['queue']['workerConcurrency'] {
    return {
      processDefault: this.workerConcurrency?.processDefault ?? this.config.concurrency,
      override,
      min: COMPUTED_OUTBOX_WORKER_CONCURRENCY_MIN,
      max: COMPUTED_OUTBOX_WORKER_CONCURRENCY_MAX,
    };
  }

  private queueClaimConcurrency(
    override: ComputedOutboxClaimConcurrencyOverride | null
  ): ComputedOutboxMonitorSnapshot['queue']['claimConcurrency'] {
    return {
      processDefault: this.claimConcurrency?.processDefault ?? {
        perBase: defaultComputedUpdateOutboxConfig.maxConcurrentProcessingPerBase,
        perSeedTable: defaultComputedUpdateOutboxConfig.maxConcurrentProcessingPerSeedTable,
      },
      override: override ?? { perBase: null, perSeedTable: null },
      min: COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MIN,
      max: COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MAX,
    };
  }

  private emptyQueue(configured: boolean): ComputedOutboxMonitorSnapshot['queue'] {
    return {
      configured,
      reachable: false,
      isPaused: false,
      workers: null,
      workerConcurrency: this.queueWorkerConcurrency(null),
      claimConcurrency: this.queueClaimConcurrency(null),
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      paused: 0,
      prioritized: 0,
      completed: 0,
      completedRetentionLimit: COMPUTED_OUTBOX_COMPLETED_RETENTION_COUNT,
      failedRetentionLimit: COMPUTED_OUTBOX_FAILED_RETENTION_COUNT,
      recentCompleted: [],
      recentFailed: [],
    };
  }

  private async inspectQueue(): Promise<ComputedOutboxMonitorSnapshot['queue']> {
    if (!this.queue) {
      return { ...this.emptyQueue(false), error: 'BullMQ queue is not configured' };
    }
    try {
      const [
        counts,
        workers,
        completedJobs,
        failedJobs,
        isPaused,
        concurrencyOverride,
        claimConcurrencyOverride,
      ] = await Promise.all([
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
        this.queue.getFailed(0, COMPUTED_OUTBOX_RECENT_FAILED_LIMIT - 1),
        typeof this.queue.isPaused === 'function' ? this.queue.isPaused() : Promise.resolve(false),
        this.workerConcurrency?.getOverride() ?? Promise.resolve(null),
        this.claimConcurrency?.getOverride() ?? Promise.resolve(null),
      ]);
      // Self-heal phantom failed counts: failed-set references whose job data
      // hash is gone (e.g. after Redis data loss) cannot be listed, retried or
      // recovered, yet inflate the count and its health alarm forever. Sweep
      // them out and report the remaining truth.
      let failed = counts.failed ?? 0;
      if (failed > 0) {
        failed = Math.max(0, failed - (await this.sweepOrphanedFailedRefs()));
      }
      return {
        configured: true,
        reachable: true,
        isPaused,
        workers,
        workerConcurrency: this.queueWorkerConcurrency(concurrencyOverride),
        claimConcurrency: this.queueClaimConcurrency(claimConcurrencyOverride),
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed,
        paused: counts.paused ?? 0,
        prioritized: counts.prioritized ?? 0,
        completed: counts.completed ?? 0,
        completedRetentionLimit: COMPUTED_OUTBOX_COMPLETED_RETENTION_COUNT,
        failedRetentionLimit: COMPUTED_OUTBOX_FAILED_RETENTION_COUNT,
        recentCompleted: completedJobs.flatMap((job) => {
          const summary = this.summarizeCompletedJob(job);
          return summary ? [summary] : [];
        }),
        recentFailed: failedJobs.flatMap((job) => {
          const summary = this.summarizeFailedJob(job);
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

  /**
   * Remove failed-set references whose job data hash no longer exists. Only
   * the bare reference is deleted (real failed jobs keep their history), so
   * nothing recoverable is lost — the durable ledger is untouched either way.
   * Throttled per process because the check touches every retained failed id;
   * a sweep failure only means the phantom count survives until the next try.
   */
  private async sweepOrphanedFailedRefs(): Promise<number> {
    if (!this.queue) return 0;
    const now = Date.now();
    if (now - this.lastOrphanSweepAt < ORPHANED_FAILED_SWEEP_MIN_INTERVAL_MS) return 0;
    this.lastOrphanSweepAt = now;
    try {
      const client = await this.queue.client;
      const failedKey = this.queue.toKey('failed');
      const ids: string[] = await client.zrange(failedKey, 0, -1);
      if (ids.length === 0) return 0;
      const pipeline = client.pipeline();
      for (const id of ids) pipeline.exists(this.queue.toKey(id));
      const results = (await pipeline.exec()) ?? [];
      const orphaned = ids.filter((_, index) => results[index]?.[1] === 0);
      if (orphaned.length === 0) return 0;
      await client.zrem(failedKey, ...orphaned);
      this.logger.log(
        `computed:outbox:orphaned_failed_refs_swept removed=${orphaned.length} retained=${ids.length - orphaned.length}`
      );
      return orphaned.length;
    } catch (error) {
      this.logger.warn('computed:outbox:orphaned_failed_refs_sweep_failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return 0;
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

  private summarizeFailedJob(
    job?: Job<ComputedOutboxWakeupWire>
  ): ComputedOutboxMonitorSnapshot['queue']['recentFailed'][number] | null {
    if (!job || !Number.isFinite(job.finishedOn)) return null;
    const finishedOn = job.finishedOn as number;
    const failedReason =
      typeof job.failedReason === 'string' && job.failedReason.length > 0
        ? job.failedReason.slice(0, 2000)
        : null;
    const wakeupResult = computedOutboxWakeupWireSchema.safeParse(job.data);
    if (!wakeupResult.success) {
      return {
        taskId: String(job.id ?? 'unknown'),
        baseId: 'unknown',
        failedAt: new Date(finishedOn).toISOString(),
        failedReason,
        attemptsMade: Math.max(0, job.attemptsMade ?? 0),
      };
    }

    return {
      taskId: wakeupResult.data.taskId,
      baseId: wakeupResult.data.baseId,
      cause: wakeupResult.data.cause,
      failedAt: new Date(finishedOn).toISOString(),
      failedReason,
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
    // A globally paused queue accepts publishes but delivers nothing — as blocking as down.
    if (queue.reachable && queue.isPaused) reasons.push('queue_paused');
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
    if (outbox.pausedPending > 0) reasons.push('paused_backlog');
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
