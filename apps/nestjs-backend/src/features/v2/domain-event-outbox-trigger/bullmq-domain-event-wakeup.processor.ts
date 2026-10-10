import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';

import { DOMAIN_EVENT_OUTBOX_WAKEUP_QUEUE } from './constants';
import { DomainEventWakeupHandler } from './domain-event-wakeup.handler';

@Processor(DOMAIN_EVENT_OUTBOX_WAKEUP_QUEUE, { concurrency: 4 })
export class BullMqDomainEventWakeupProcessor extends WorkerHost {
  private readonly logger = new Logger(BullMqDomainEventWakeupProcessor.name);

  constructor(private readonly handler: DomainEventWakeupHandler) {
    super();
  }

  async process(job: Job<{ eventId?: string; baseId?: string }>): Promise<void> {
    const eventId = job.data?.eventId;
    const baseId = job.data?.baseId;
    if (!eventId || !baseId) {
      throw new UnrecoverableError('Invalid domain event wakeup payload');
    }
    try {
      await this.handler.handle({ eventId, baseId });
    } catch (error) {
      this.logger.warn('domain_event:wakeup_process_failed', {
        eventId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  }
}
