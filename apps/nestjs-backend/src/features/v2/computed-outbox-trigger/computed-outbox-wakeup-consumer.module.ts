import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';

import { readComputedOutboxBoolean } from '../../../configs/computed-outbox-trigger.config';
import { V2Module } from '../v2.module';
import { BullMqComputedOutboxWakeupProcessor } from './bullmq-computed-outbox-wakeup.processor';
import { ComputedOutboxWakeupHandler } from './computed-outbox-wakeup.handler';

@Module({
  imports: [V2Module],
  providers: [ComputedOutboxWakeupHandler, BullMqComputedOutboxWakeupProcessor],
})
class ComputedOutboxWakeupConsumerRuntimeModule {}

@Module({})
export class ComputedOutboxWakeupConsumerModule {
  static async register(): Promise<DynamicModule> {
    return ConditionalModule.registerWhen(
      ComputedOutboxWakeupConsumerRuntimeModule,
      (env) => readComputedOutboxBoolean(env.V2_COMPUTED_OUTBOX_TRIGGER_CONSUMER_ENABLED, true),
      { timeout: process.env.NODE_ENV === 'test' ? 60_000 : 5000 }
    );
  }
}
