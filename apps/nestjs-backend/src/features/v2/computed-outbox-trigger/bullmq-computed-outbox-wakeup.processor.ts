import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Inject,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createComputedOutboxWakeup } from '@teable/v2-adapter-table-repository-postgres';
import { UnrecoverableError, type Job } from 'bullmq';

import { ComputedOutboxTriggerMetrics } from './computed-outbox-trigger.metrics';
import type { ComputedOutboxWakeupHandlerOutcome } from './computed-outbox-wakeup.handler';
import { ComputedOutboxWakeupHandler } from './computed-outbox-wakeup.handler';
import { IComputedOutboxWakeupAppPublisher } from './computed-outbox-wakeup.publisher';
import {
  computedOutboxWakeupWireSchema,
  type ComputedOutboxWakeupWire,
} from './computed-outbox-wakeup.wire';
import { ComputedOutboxWorkerConcurrencyService } from './computed-outbox-worker-concurrency.service';
import { COMPUTED_OUTBOX_WAKEUP_PUBLISHER, COMPUTED_OUTBOX_WAKEUP_QUEUE } from './constants';

const concurrency = Number(process.env.V2_COMPUTED_OUTBOX_TRIGGER_CONCURRENCY ?? 8);
/** How often each consumer checks Redis for a runtime concurrency override. */
const CONCURRENCY_POLL_INTERVAL_MS = 15_000;

@Processor(COMPUTED_OUTBOX_WAKEUP_QUEUE, {
  concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 8,
})
export class BullMqComputedOutboxWakeupProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(BullMqComputedOutboxWakeupProcessor.name);
  private concurrencyPollTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly handler: ComputedOutboxWakeupHandler,
    private readonly metrics: ComputedOutboxTriggerMetrics,
    @Inject(COMPUTED_OUTBOX_WAKEUP_PUBLISHER)
    private readonly wakeupPublisher: IComputedOutboxWakeupAppPublisher,
    @Optional()
    private readonly concurrencySettings?: ComputedOutboxWorkerConcurrencyService
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    if (!this.concurrencySettings) return;
    void this.applyConcurrencyOverride().finally(() => this.scheduleConcurrencyPoll());
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.concurrencyPollTimer) clearTimeout(this.concurrencyPollTimer);
  }

  private scheduleConcurrencyPoll(): void {
    if (this.stopped) return;
    this.concurrencyPollTimer = setTimeout(() => {
      void this.applyConcurrencyOverride().finally(() => this.scheduleConcurrencyPoll());
    }, CONCURRENCY_POLL_INTERVAL_MS);
    this.concurrencyPollTimer.unref?.();
  }

  /**
   * Hot-apply the cluster-wide override (or fall back to this process's env
   * default) — BullMQ supports mutating Worker#concurrency live, so no
   * restart is needed. In-flight jobs are unaffected.
   */
  private async applyConcurrencyOverride(): Promise<void> {
    if (!this.concurrencySettings) return;
    try {
      const override = await this.concurrencySettings.getOverride();
      const target = override ?? this.concurrencySettings.processDefault;
      const worker = this.worker;
      if (worker.concurrency === target) return;
      worker.concurrency = target;
      this.logger.log('computed:outbox:worker_concurrency_applied', {
        concurrency: target,
        source: override == null ? 'default' : 'override',
      });
    } catch {
      // Worker not initialized yet or Redis briefly unavailable — the next
      // poll tick retries; the env-configured concurrency stays in effect.
    }
  }

  // The outcome becomes the job's retained return value so the admin job
  // browser can tell a real `processed` completion apart from noop/deferred.
  async process(job: Job<unknown>): Promise<ComputedOutboxWakeupHandlerOutcome> {
    const parsed = computedOutboxWakeupWireSchema.safeParse(job.data);
    if (!parsed.success) {
      this.metrics.recordConsume('invalid');
      throw new UnrecoverableError('Invalid computed outbox wake-up payload');
    }
    const wakeup = parsed.data as ComputedOutboxWakeupWire;
    try {
      // Join the originating write trace when the producer captured W3C context.
      return await this.handler.handle(wakeup);
    } catch (error) {
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        await this.wakeupPublisher
          .runAsConsumer(() =>
            this.wakeupPublisher.publish(
              createComputedOutboxWakeup({
                taskId: wakeup.taskId,
                baseId: wakeup.baseId,
                availableAt: new Date(Date.now() + 30_000),
                cause: 'replay',
                ...(wakeup.traceparent ? { traceparent: wakeup.traceparent } : {}),
                ...(wakeup.tracestate ? { tracestate: wakeup.tracestate } : {}),
              })
            )
          )
          .catch(() => undefined);
      }
      throw error;
    }
  }
}
