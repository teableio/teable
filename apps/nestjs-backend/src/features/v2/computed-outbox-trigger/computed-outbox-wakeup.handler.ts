import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  createComputedOutboxWakeup,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
  type IComputedUpdateOutbox,
} from '@teable/v2-adapter-table-repository-postgres';

import { V2ContainerService } from '../v2-container.service';
import { ComputedOutboxTriggerMetrics } from './computed-outbox-trigger.metrics';
import { IComputedOutboxWakeupAppPublisher } from './computed-outbox-wakeup.publisher';
import type { ComputedOutboxWakeupWire } from './computed-outbox-wakeup.wire';
import { COMPUTED_OUTBOX_WAKEUP_PUBLISHER } from './constants';

export type ComputedOutboxWakeupHandlerOutcome = {
  status: 'processed' | 'noop' | 'deferred';
};

/** Minimum delay for transient claim races and database lock misses. */
const MIN_DEFER_DELAY_MS = 2_000;
/** Conservative retry for blockers without a deterministic release time (pause/concurrency). */
const BLOCKED_DEFER_DELAY_MS = 30_000;

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

      // Pending (concurrency / pause / not-due) or still-actionable processing: re-arm a delayed
      // wake-up so exclusive BullMQ mode does not permanently drop non-terminal claim misses.
      const fallbackDelay =
        eligibility.status === 'deferred' &&
        (eligibility.reason === 'paused' || eligibility.reason === 'concurrency')
          ? BLOCKED_DEFER_DELAY_MS
          : MIN_DEFER_DELAY_MS;
      const retryAt = eligibility.status === 'deferred' ? eligibility.retryAt : null;
      const availableAt = new Date(
        Math.max(Date.now() + fallbackDelay, retryAt?.getTime() ?? Number.NEGATIVE_INFINITY)
      );
      await this.wakeupPublisher.publish(
        createComputedOutboxWakeup({
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
