import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  createComputedOutboxWakeup,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
  type IComputedUpdateOutbox,
  type OutboxTaskClaimEligibility,
} from '@teable/v2-adapter-table-repository-postgres';

import { V2ContainerService } from '../v2-container.service';
import { ComputedOutboxTriggerMetrics } from './computed-outbox-trigger.metrics';
import { IComputedOutboxWakeupAppPublisher } from './computed-outbox-wakeup.publisher';
import type { ComputedOutboxWakeupWire } from './computed-outbox-wakeup.wire';
import { COMPUTED_OUTBOX_WAKEUP_PUBLISHER } from './constants';

export type ComputedOutboxWakeupHandlerOutcome = {
  status: 'processed' | 'noop' | 'deferred' | 'parked';
};

/** Minimum delay for transient claim races and database lock misses. */
const MIN_DEFER_DELAY_MS = 2_000;
/**
 * Retry when the base concurrency/advisory slot is busy.
 * Keep this short: a successful worker now drains the remaining queue immediately
 * (see drainRemainingOutbox), so long concurrency sleeps only add dual-link lag
 * when that drain races another claim miss. Pause still uses deterministic resume.
 */
const CONCURRENCY_DEFER_DELAY_MS = 100;
/** Conservative retry for blockers without a deterministic release time. */
const BLOCKED_DEFER_DELAY_MS = 30_000;
/** Per claimBatch size while continuing after a targeted wake-up. */
const POST_PROCESS_DRAIN_BATCH_SIZE = 50;
/** Hard cap so a pathological queue cannot pin one consumer forever. */
const POST_PROCESS_DRAIN_MAX_TASKS = 500;

const createDeferredWakeupId = (taskId: string, availableAt: Date, bucketMs?: number): string =>
  `cuwd-${taskId}-${
    bucketMs ? Math.floor(availableAt.getTime() / bucketMs) : availableAt.getTime()
  }`;

const isIndefinitelyPaused = (eligibility: OutboxTaskClaimEligibility): boolean =>
  eligibility.status === 'deferred' &&
  eligibility.reason === 'paused' &&
  eligibility.retryAt === null;

const resolveDeferredWakeup = (
  taskId: string,
  currentWakeupId: string,
  eligibility: Exclude<OutboxTaskClaimEligibility, { status: 'terminal' }>,
  nowMs: number
): { wakeupId: string; availableAt: Date } => {
  const fallbackDelay =
    eligibility.status === 'deferred' && eligibility.reason === 'concurrency'
      ? CONCURRENCY_DEFER_DELAY_MS
      : eligibility.status === 'deferred' && eligibility.reason === 'paused'
        ? BLOCKED_DEFER_DELAY_MS
        : MIN_DEFER_DELAY_MS;
  const retryAt = eligibility.status === 'deferred' ? eligibility.retryAt : null;
  const finitePauseResumeAt =
    eligibility.status === 'deferred' && eligibility.reason === 'paused' && retryAt !== null
      ? retryAt
      : null;
  let availableAt =
    finitePauseResumeAt ??
    new Date(Math.max(nowMs + fallbackDelay, retryAt?.getTime() ?? Number.NEGATIVE_INFINITY));
  const baseWakeupId = createDeferredWakeupId(
    taskId,
    availableAt,
    finitePauseResumeAt ? undefined : fallbackDelay
  );
  if (currentWakeupId === baseWakeupId || currentWakeupId.startsWith(`${baseWakeupId}-r`)) {
    availableAt = new Date(Math.max(availableAt.getTime(), nowMs + MIN_DEFER_DELAY_MS));
    return {
      availableAt,
      wakeupId: `${baseWakeupId}-r${Math.floor(availableAt.getTime() / MIN_DEFER_DELAY_MS)}`,
    };
  }
  return {
    availableAt,
    wakeupId: baseWakeupId,
  };
};

@Injectable()
export class ComputedOutboxWakeupHandler {
  private readonly logger = new Logger(ComputedOutboxWakeupHandler.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly metrics: ComputedOutboxTriggerMetrics,
    @Inject(COMPUTED_OUTBOX_WAKEUP_PUBLISHER)
    private readonly wakeupPublisher: IComputedOutboxWakeupAppPublisher
  ) {}

  async handle(wakeup: ComputedOutboxWakeupWire): Promise<ComputedOutboxWakeupHandlerOutcome> {
    return this.wakeupPublisher.runAsConsumer(() => this.handleAsConsumer(wakeup));
  }

  private async handleAsConsumer(
    wakeup: ComputedOutboxWakeupWire
  ): Promise<ComputedOutboxWakeupHandlerOutcome> {
    const startedAt = performance.now();
    this.metrics.recordDeliveryLag(Date.now() - new Date(wakeup.availableAt).getTime());

    try {
      const container = await this.v2ContainerService.getContainerForBase(wakeup.baseId);
      const worker = container.resolve<ComputedUpdateWorker>(
        v2RecordRepositoryPostgresTokens.computedUpdateWorker
      );
      const workerId = `computed-queue-${process.pid}`;
      const result = await worker.runTaskById({
        taskId: wakeup.taskId,
        workerId,
        // Healthy leases must not be stolen; claimById still reclaims expired processing.
        allowProcessingTakeover: false,
      });
      if (result.isErr()) throw result.error;

      if (result.value) {
        // A processed seed/computed task can enqueue the next cascade stage (and bulk
        // dual-link writes leave sibling seed tasks pending). Drain them in-process
        // immediately instead of waiting for another BullMQ delivery or a multi-second
        // concurrency defer — this restores the T6191 "continue after any progress"
        // behavior after polling was replaced by BullMQ-only wake-ups.
        await this.drainRemainingOutbox(worker, workerId, wakeup.baseId);
        this.metrics.recordConsume('processed');
        this.metrics.recordExecutionDuration(performance.now() - startedAt, 'processed');
        return { status: 'processed' };
      }

      const outbox = container.resolve<IComputedUpdateOutbox>(
        v2RecordRepositoryPostgresTokens.computedUpdateOutbox
      );
      const eligibilityResult = await outbox.getTaskClaimEligibility(wakeup.taskId);
      if (eligibilityResult.isErr()) throw eligibilityResult.error;

      const eligibility = eligibilityResult.value;
      if (!eligibility || eligibility.status === 'terminal') {
        this.metrics.recordConsume('noop');
        this.metrics.recordExecutionDuration(performance.now() - startedAt, 'noop');
        return { status: 'noop' };
      }

      if (isIndefinitelyPaused(eligibility)) {
        this.metrics.recordConsume('parked');
        this.metrics.recordExecutionDuration(performance.now() - startedAt, 'parked');
        this.logger.debug('computed:outbox:wakeup_parked', {
          taskId: wakeup.taskId,
          baseId: wakeup.baseId,
          reason: 'paused',
        });
        return { status: 'parked' };
      }

      // Finite pauses use the explicit resume time. Other transient misses use a deterministic
      // time bucket so duplicate locators converge without swallowing the next retry cycle.
      const { availableAt, wakeupId } = resolveDeferredWakeup(
        wakeup.taskId,
        wakeup.wakeupId,
        eligibility,
        Date.now()
      );
      await this.wakeupPublisher.publish(
        createComputedOutboxWakeup({
          wakeupId,
          taskId: wakeup.taskId,
          baseId: wakeup.baseId,
          availableAt,
          cause: 'replay',
        })
      );
      this.metrics.recordConsume('deferred');
      this.metrics.recordExecutionDuration(performance.now() - startedAt, 'deferred');
      this.logger.debug('computed:outbox:wakeup_deferred', {
        taskId: wakeup.taskId,
        baseId: wakeup.baseId,
        eligibility: eligibility.status,
        reason: eligibility.status === 'deferred' ? eligibility.reason : undefined,
        availableAt: availableAt.toISOString(),
      });
      return { status: 'deferred' };
    } catch (error) {
      this.metrics.recordConsume('error');
      this.metrics.recordExecutionDuration(performance.now() - startedAt, 'error');
      throw error;
    }
  }

  /**
   * Keep claiming until an empty poll proves the outbox is idle for this worker.
   * Mirrors the pre-BullMQ polling continue_immediately policy (T6191).
   */
  private async drainRemainingOutbox(
    worker: ComputedUpdateWorker,
    workerId: string,
    baseId: string
  ): Promise<void> {
    let drained = 0;
    while (drained < POST_PROCESS_DRAIN_MAX_TASKS) {
      const more = await worker.runOnce({
        workerId,
        limit: POST_PROCESS_DRAIN_BATCH_SIZE,
      });
      if (more.isErr()) {
        this.logger.warn('computed:outbox:post_process_drain_failed', {
          baseId,
          workerId,
          drained,
          error: more.error.message,
        });
        return;
      }
      if (more.value <= 0) {
        if (drained > 0) {
          this.logger.debug('computed:outbox:post_process_drain_idle', {
            baseId,
            workerId,
            drained,
          });
        }
        return;
      }
      drained += more.value;
      this.logger.debug('computed:outbox:post_process_drain_continue', {
        baseId,
        workerId,
        processed: more.value,
        drained,
      });
    }
    this.logger.warn('computed:outbox:post_process_drain_capped', {
      baseId,
      workerId,
      drained,
      maxTasks: POST_PROCESS_DRAIN_MAX_TASKS,
    });
  }
}
