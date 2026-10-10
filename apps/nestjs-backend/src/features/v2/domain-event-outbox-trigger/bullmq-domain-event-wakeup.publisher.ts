import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type {
  DomainEventWakeup,
  IDomainEventWakeupPublisher,
} from '@teable/v2-adapter-table-repository-postgres';
import { Queue } from 'bullmq';

import { DOMAIN_EVENT_OUTBOX_WAKEUP_JOB, DOMAIN_EVENT_OUTBOX_WAKEUP_QUEUE } from './constants';

@Injectable()
export class BullMqDomainEventWakeupPublisher implements IDomainEventWakeupPublisher {
  private readonly logger = new Logger(BullMqDomainEventWakeupPublisher.name);

  constructor(
    @InjectQueue(DOMAIN_EVENT_OUTBOX_WAKEUP_QUEUE)
    private readonly queue: Queue<{ eventId: string; baseId: string }>
  ) {}

  async publish(wakeup: DomainEventWakeup): Promise<void> {
    try {
      await this.queue.add(
        DOMAIN_EVENT_OUTBOX_WAKEUP_JOB,
        { eventId: wakeup.eventId, baseId: wakeup.baseId },
        {
          jobId: wakeup.eventId,
          removeOnComplete: 1000,
          removeOnFail: 5000,
        }
      );
    } catch (error) {
      this.logger.warn('domain_event:wakeup_try_submit_failed', {
        eventId: wakeup.eventId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
}
