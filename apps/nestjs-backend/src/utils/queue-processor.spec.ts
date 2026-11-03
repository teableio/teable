import { WorkerHost } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import type { Worker } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { Processor, startQueueWorkers } from './queue-processor';

// where @nestjs/bullmq keeps the options its explorer hands to `new Worker()`
const WORKER_METADATA = 'bullmq:worker_metadata';

class TestHost extends WorkerHost {
  constructor(worker: Partial<Worker>) {
    super();
    // where WorkerHost keeps the worker the explorer created for it
    Reflect.set(this, '_worker', worker);
  }

  async process() {}
}

const fakeWorker = (run: () => Promise<void> = () => Promise.resolve()) => ({
  run: vi.fn(run),
  emit: vi.fn(),
});

const appWith = (instances: unknown[]) =>
  ({
    get: () => ({ getProviders: () => instances.map((instance) => ({ instance })) }),
  }) as unknown as INestApplicationContext;

describe('Processor', () => {
  it('creates workers that do not consume until started', () => {
    @Processor('test-queue', { concurrency: 3 })
    class WithOptions extends WorkerHost {
      async process() {}
    }
    @Processor('test-queue')
    class WithoutOptions extends WorkerHost {
      async process() {}
    }

    expect(Reflect.getMetadata(WORKER_METADATA, WithOptions)).toEqual({
      concurrency: 3,
      autorun: false,
    });
    expect(Reflect.getMetadata(WORKER_METADATA, WithoutOptions)).toEqual({ autorun: false });
  });
});

describe('startQueueWorkers', () => {
  it('runs each worker once', () => {
    const worker = fakeWorker();
    const other = fakeWorker();
    const host = new TestHost(worker);

    startQueueWorkers(appWith([host, host, new TestHost(other), {}, undefined]));

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(other.run).toHaveBeenCalledTimes(1);
  });

  it('reports a failed run as a worker error', async () => {
    const error = new Error('boom');
    const worker = fakeWorker(() => Promise.reject(error));

    startQueueWorkers(appWith([new TestHost(worker)]));

    await vi.waitFor(() => expect(worker.emit).toHaveBeenCalledWith('error', error));
  });
});
