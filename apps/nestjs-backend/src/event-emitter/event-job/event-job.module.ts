import { BullModule } from '@nestjs/bullmq';
import type { NestWorkerOptions } from '@nestjs/bullmq/dist/interfaces/worker-options.interface';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { ConfigModule } from '../../configs/config.module';
import { FallbackQueueModule } from './fallback/fallback-queue.module';

const queueOptions: NestWorkerOptions = {
  removeOnComplete: {
    count: 2000,
  },
  removeOnFail: {
    count: 5000,
  },
};

@Module({
  imports: [ConfigModule],
})
export class EventJobModule {
  static async registerQueue(name: string): Promise<DynamicModule> {
    const [bullQueue, fallbackQueue] = await Promise.all([
      ConditionalModule.registerWhen(
        BullModule.registerQueue({
          name,
          ...queueOptions,
        }),
        (env) => Boolean(env.BACKEND_CACHE_REDIS_URI)
      ),
      ConditionalModule.registerWhen(
        FallbackQueueModule.registerQueue(name),
        (env) => !env.BACKEND_CACHE_REDIS_URI
      ),
    ]);

    return {
      module: EventJobModule,
      imports: [bullQueue, fallbackQueue],
      exports: [bullQueue, fallbackQueue],
    };
  }
}
