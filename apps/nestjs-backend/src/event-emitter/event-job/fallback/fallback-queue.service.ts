import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { Reflector, DiscoveryService } from '@nestjs/core';
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import type { Job } from 'bullmq';
import { localQueueEventEmitter } from './event-emitter';

export const PROCESSOR_METADATA = 'bullmq:processor_metadata';

@Injectable()
export class FallbackQueueService implements OnModuleInit {
  private logger = new Logger(FallbackQueueService.name);
  constructor(
    private readonly reflector: Reflector,
    private readonly discoveryService: DiscoveryService
  ) {}

  async onModuleInit() {
    this.logger.debug('FallbackQueueService init');
    this.collectionProcess();
  }

  collectionProcess() {
    const providers: InstanceWrapper[] = this.discoveryService
      .getProviders()
      .filter((wrapper: InstanceWrapper) => {
        const target =
          !wrapper.metatype || wrapper.inject ? wrapper.instance?.constructor : wrapper.metatype;
        if (!target) {
          return false;
        }
        return !!this.reflector.get(PROCESSOR_METADATA, target);
      });

    providers.forEach((wrapper: InstanceWrapper) => {
      const { instance, metatype } = wrapper;
      if (!wrapper.isDependencyTreeStatic()) {
        return;
      }

      const { name: queueName } = this.reflector.get(
        PROCESSOR_METADATA,
        instance.constructor || metatype
      );
      localQueueEventEmitter.on('handle-listener', (job: Job<unknown>) => {
        if (job.queueName !== queueName) {
          return;
        }
        this.handleListener(wrapper, job);
      });
    });
  }

  private handleListener(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wrapper: InstanceWrapper,
    job: Job<unknown>
  ) {
    const { instance } = wrapper;
    const methodName = 'process';
    if (!instance[methodName]) {
      this.logger.warn(`${instance.constructor.name} has no method ${methodName}`);
      return;
    }
    instance[methodName].call(instance, job);
  }
}
