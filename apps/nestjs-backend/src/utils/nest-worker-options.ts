import type { WorkerOptions } from 'bullmq';

/**
 * Worker options accepted by `@Processor(queueName, options)`. `@nestjs/bullmq` 12 no longer
 * exposes its internal `NestWorkerOptions` type through a deep import; the module supplies
 * `connection` itself, so it is optional here exactly as it was there.
 */
export type NestWorkerOptions = Omit<WorkerOptions, 'connection'> &
  Partial<Pick<WorkerOptions, 'connection'>>;
