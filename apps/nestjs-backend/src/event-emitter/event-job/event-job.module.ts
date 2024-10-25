import { BullModule } from '@nestjs/bullmq';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { FallbackQueueModule } from './fallback/fallback-queue.module';

@Module({})
export class EventJobModule {
  static registerQueue(name: string): DynamicModule {
    const exportModule = process.env.BACKEND_CACHE_REDIS_URI ? BullModule : FallbackQueueModule;
    return {
      module: EventJobModule,
      imports: [exportModule.registerQueue(name)],
      exports: [exportModule],
    };
  }
}
