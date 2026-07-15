import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { createComputedOutboxWakeup } from '@teable/v2-adapter-table-repository-postgres';
import { UnrecoverableError, type Job } from 'bullmq';

import { ComputedOutboxTriggerMetrics } from './computed-outbox-trigger.metrics';
import { ComputedOutboxWakeupHandler } from './computed-outbox-wakeup.handler';
import { IComputedOutboxWakeupAppPublisher } from './computed-outbox-wakeup.publisher';
import {
  computedOutboxWakeupWireSchema,
  type ComputedOutboxWakeupWire,
} from './computed-outbox-wakeup.wire';
import { COMPUTED_OUTBOX_WAKEUP_PUBLISHER, COMPUTED_OUTBOX_WAKEUP_QUEUE } from './constants';

const concurrency = Number(process.env.V2_COMPUTED_OUTBOX_TRIGGER_CONCURRENCY ?? 8);

@Processor(COMPUTED_OUTBOX_WAKEUP_QUEUE, {
  concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 8,
})
export class BullMqComputedOutboxWakeupProcessor extends WorkerHost {
  constructor(
    private readonly handler: ComputedOutboxWakeupHandler,
    private readonly metrics: ComputedOutboxTriggerMetrics,
    @Inject(COMPUTED_OUTBOX_WAKEUP_PUBLISHER)
    private readonly wakeupPublisher: IComputedOutboxWakeupAppPublisher
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    const parsed = computedOutboxWakeupWireSchema.safeParse(job.data);
    if (!parsed.success) {
      this.metrics.recordConsume('invalid');
      throw new UnrecoverableError('Invalid computed outbox wake-up payload');
    }
    const wakeup = parsed.data as ComputedOutboxWakeupWire;
    try {
      await this.handler.handle(wakeup);
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
              })
            )
          )
          .catch(() => undefined);
      }
      throw error;
    }
  }
}
