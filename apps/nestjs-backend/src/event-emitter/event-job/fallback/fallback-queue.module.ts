import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { FallbackQueueService } from './fallback-queue.service';
import { createLocalQueueProvider } from './local-queue.provider';

@Module({})
export class FallbackQueueModule {
  static registerQueue(name: string): DynamicModule {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const LocalQueueProvider = createLocalQueueProvider(name);
    return {
      module: FallbackQueueModule,
      providers: [FallbackQueueService, DiscoveryService, LocalQueueProvider],
      exports: [LocalQueueProvider],
    };
  }
}
