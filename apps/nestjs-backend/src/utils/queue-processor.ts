import { Processor as BullProcessor, WorkerHost } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { Worker } from 'bullmq';
import type { NestWorkerOptions } from './nest-worker-options';

const DRAIN_BEFORE = Symbol('queue-drain-before');

/**
 * `@Processor` for every BullMQ consumer in the backend. @nestjs/bullmq creates workers in its
 * global module's onModuleInit, which Nest runs before any other module's lifecycle hooks, and a
 * worker consumes as soon as it is created: a starting pod used to run jobs against providers
 * that had not initialized yet. Workers are still created at that point, so lifecycle hooks can
 * keep using `this.worker`, but consume only once startQueueWorkers runs them.
 */
export const Processor =
  (
    queueName: string,
    workerOptions: NestWorkerOptions = {},
    drainBefore: ReadonlyArray<string> = []
  ): ClassDecorator =>
  (target) => {
    Reflect.defineMetadata(DRAIN_BEFORE, drainBefore, target);
    return BullProcessor(queueName, { ...workerOptions, autorun: false })(target);
  };

function getQueueWorkers(discovery: DiscoveryService): Map<Worker, ReadonlyArray<string>> {
  const workers = new Map<Worker, ReadonlyArray<string>>();
  for (const { instance } of discovery.getProviders()) {
    if (!(instance instanceof WorkerHost)) continue;
    try {
      // The public getter throws when registration was disabled or has not run.
      workers.set(instance.worker, Reflect.getMetadata(DRAIN_BEFORE, instance.constructor) ?? []);
    } catch {
      continue;
    }
  }
  return workers;
}

/** Stop producers before consumers whose jobs they enqueue and await while still active. */
export function pauseQueueWorkers(discovery: DiscoveryService): Promise<void>[] {
  const workers = getQueueWorkers(discovery);
  const pauses = new Map<Worker, Promise<void>>();
  const pause = (worker: Worker): Promise<void> => {
    const existing = pauses.get(worker);
    if (existing) return existing;
    // Defer recursion until every promise is installed. Rejected producers must not skip consumers;
    // their own pause promise still reports the failure to the single container drain budget.
    const pending = Promise.resolve().then(async () => {
      const producers = [...workers].filter(([, consumers]) => consumers.includes(worker.name));
      if (producers.length) {
        await Promise.allSettled(producers.map(([producer]) => pause(producer)));
      }
      await worker.pause();
    });
    pauses.set(worker, pending);
    return pending;
  };
  return [...workers.keys()].map(pause);
}

/** Force close after a failed drain so Nest's later close cannot wait on abandoned active jobs. */
export function forceCloseQueueWorkers(discovery: DiscoveryService): Promise<void>[] {
  return [...getQueueWorkers(discovery).keys()].map((worker) => {
    try {
      // Call immediately: BullMQ installs `closing` synchronously, before the normal Nest close.
      return worker.close(true);
    } catch (error) {
      return Promise.reject(error);
    }
  });
}

/** Runs every queue worker; call once the application has finished initializing. */
export function startQueueWorkers(app: INestApplicationContext): void {
  const workers = getQueueWorkers(app.get(DiscoveryService));
  for (const worker of workers.keys()) {
    // what bullmq does itself with autorun
    worker.run().catch((error) => worker.emit('error', error));
  }
  new Logger('QueueWorkers').log(`Started ${workers.size} queue worker(s)`);
}
