import { Module } from '@nestjs/common';

import { V2Module } from '../v2.module';
import { BullMqDomainEventWakeupProcessor } from './bullmq-domain-event-wakeup.processor';
import { DomainEventOutboxRelayService } from './domain-event-outbox-relay.service';
import { DomainEventWakeupHandler } from './domain-event-wakeup.handler';

@Module({
  imports: [V2Module],
  providers: [
    DomainEventWakeupHandler,
    BullMqDomainEventWakeupProcessor,
    DomainEventOutboxRelayService,
  ],
})
export class DomainEventWakeupConsumerModule {}
