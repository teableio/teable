import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { BullMqDomainEventWakeupPublisher } from './bullmq-domain-event-wakeup.publisher';
import {
  DOMAIN_EVENT_OUTBOX_WAKEUP_PUBLISHER,
  DOMAIN_EVENT_OUTBOX_WAKEUP_QUEUE,
} from './constants';

@Module({
  imports: [BullModule.registerQueue({ name: DOMAIN_EVENT_OUTBOX_WAKEUP_QUEUE })],
  providers: [
    BullMqDomainEventWakeupPublisher,
    {
      provide: DOMAIN_EVENT_OUTBOX_WAKEUP_PUBLISHER,
      useExisting: BullMqDomainEventWakeupPublisher,
    },
  ],
  exports: [DOMAIN_EVENT_OUTBOX_WAKEUP_PUBLISHER, BullModule],
})
export class DomainEventWakeupProducerModule {}
