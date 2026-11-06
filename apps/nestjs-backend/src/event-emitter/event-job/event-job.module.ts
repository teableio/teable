import { BullModule } from '@nestjs/bullmq';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule } from '../../configs/config.module';
import type { NestWorkerOptions } from '../../utils/nest-worker-options';

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
  static registerQueue(name: string): DynamicModule {
    const bullQueue = BullModule.registerQueue({
      name,
      ...queueOptions,
    });

    return {
      module: EventJobModule,
      imports: [bullQueue],
      exports: [bullQueue],
    };
  }
}
