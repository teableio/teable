import { Processor as BullProcessor, WorkerHost } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { Worker } from 'bullmq';
import type { NestWorkerOptions } from './nest-worker-options';

/**
 * `@Processor` for every BullMQ consumer in the backend. @nestjs/bullmq creates workers in its
 * global module's onModuleInit, which Nest runs before any other module's lifecycle hooks, and a
 * worker consumes as soon as it is created: a starting pod used to run jobs against providers
 * that had not initialized yet. Workers are still created at that point, so lifecycle hooks can
 * keep using `this.worker`, but consume only once startQueueWorkers runs them.
 */
export const Processor = (
  queueName: string,
  workerOptions: NestWorkerOptions = {}
): ClassDecorator => BullProcessor(queueName, { ...workerOptions, autorun: false });

/** Runs every queue worker; call once the application has finished initializing. */
export function startQueueWorkers(app: INestApplicationContext): void {
  const workers = new Set<Worker>();
  for (const { instance } of app.get(DiscoveryService).getProviders()) {
    if (instance instanceof WorkerHost) {
      workers.add(instance.worker);
    }
  }
  for (const worker of workers) {
    // what bullmq does itself with autorun
    worker.run().catch((error) => worker.emit('error', error));
  }
  new Logger('QueueWorkers').log(`Started ${workers.size} queue worker(s)`);
}
