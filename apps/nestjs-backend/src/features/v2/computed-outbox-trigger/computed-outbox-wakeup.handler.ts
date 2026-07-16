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
/** Conservative retry for blockers without a deterministic release time (pause/concurrency). */
const BLOCKED_DEFER_DELAY_MS = 30_000;

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
      const result = await worker.runTaskById({
        taskId: wakeup.taskId,
        workerId: `computed-queue-${process.pid}`,
        // Healthy leases must not be stolen; claimById still reclaims expired processing.
        allowProcessingTakeover: false,
      });
      if (result.isErr()) throw result.error;

      if (result.value) {
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
}
