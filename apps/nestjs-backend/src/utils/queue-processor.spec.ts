import { WorkerHost } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import type { DiscoveryService } from '@nestjs/core';
import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  forceCloseQueueWorkers,
  pauseQueueWorkers,
  Processor,
  startQueueWorkers,
} from './queue-processor';

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

// The backend targets ES2022, before Promise.withResolvers is declared.
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
};

// Keep BullMQ's real pause, fetch, mainLoop and close methods. Only Redis/telemetry/lock I/O
// boundaries are substituted, so this fixture cannot accidentally model pause as admission-safe.
function localWorker(name: string) {
  const worker: Worker = Object.create(Worker.prototype);
  Object.assign(worker, {
    name,
    id: name,
    opts: {},
    _concurrency: 1,
    running: false,
    connection: { client: Promise.resolve({}), close: vi.fn(async () => undefined) },
    blockingConnection: { client: Promise.resolve({}), close: vi.fn(async () => undefined) },
    lockManager: { close: vi.fn(async () => undefined) },
    trace: (_kind: unknown, _operation: string, _name: string, callback: () => unknown) =>
      callback(),
    emit: vi.fn(),
  });
  return worker;
}

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

describe('pauseQueueWorkers', () => {
  it('pauses initialized local workers concurrently and waits for active jobs', async () => {
    const first = deferred();
    const second = deferred();
    const worker = { pause: vi.fn(() => first.promise), close: vi.fn() };
    const other = { pause: vi.fn(() => second.promise), close: vi.fn() };
    const host = new TestHost(worker);
    const disabled = new TestHost({});
    Reflect.deleteProperty(disabled, '_worker');
    const discovery = appWith([host, host, new TestHost(other), disabled, {}, undefined]).get(
      'discovery'
    ) as DiscoveryService;

    const pauses = pauseQueueWorkers(discovery);
    const finished = vi.fn();
    const settled = Promise.all(pauses).then(finished);
    await Promise.resolve();

    expect(pauses).toHaveLength(2);
    expect(worker.pause).toHaveBeenCalledExactlyOnceWith();
    expect(other.pause).toHaveBeenCalledExactlyOnceWith();
    expect(finished).not.toHaveBeenCalled();
    first.resolve();
    await first.promise;
    expect(finished).not.toHaveBeenCalled();
    second.resolve();
    await settled;
    expect(finished).toHaveBeenCalledOnce();
    expect(worker.close).not.toHaveBeenCalled();
    expect(other.close).not.toHaveBeenCalled();
  });

  it('returns worker failures to the caller without skipping other workers', async () => {
    const error = new Error('pause failed');
    const worker = { pause: vi.fn(() => Promise.reject(error)) };
    const other = { pause: vi.fn(() => Promise.resolve()) };
    const discovery = appWith([new TestHost(worker), new TestHost(other)]).get(
      'discovery'
    ) as DiscoveryService;

    const results = await Promise.allSettled(pauseQueueWorkers(discovery));

    expect(results).toEqual([
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: undefined },
    ]);
    expect(other.pause).toHaveBeenCalledExactlyOnceWith();
  });

  it('keeps the child consumer admitting jobs enqueued by an accepted parent after shutdown starts', async () => {
    const parent = localWorker('csv-chunks');
    const child = localWorker('csv-rows');
    const shutdownStarted = deferred();
    const childFinished = deferred();
    const fetched: Job[] = [];
    const job = { id: 'late-child', opts: {} } as Job;
    const moveToActive = vi.fn(async () => fetched.shift());
    Reflect.set(child, 'moveToActive', moveToActive);
    const processChild = vi.fn();
    const parentJob = (async () => {
      await shutdownStarted.promise;
      fetched.push(job);
      const admitted = await child.getNextJob('child-token', { block: false });
      if (admitted) {
        processChild(admitted);
        childFinished.resolve();
      }
      await childFinished.promise;
    })();
    Reflect.set(parent, 'mainLoopRunning', parentJob);

    @Processor('csv-chunks', {}, ['csv-rows'])
    class ParentHost extends TestHost {}

    const discovery = appWith([new TestHost(child), new ParentHost(parent)]).get(
      'discovery'
    ) as DiscoveryService;
    const pauses = pauseQueueWorkers(discovery);
    await Promise.resolve();
    expect(parent.isPaused()).toBe(true);
    expect(child.isPaused()).toBe(false);

    shutdownStarted.resolve();
    await Promise.all(pauses);
    expect(processChild).toHaveBeenCalledExactlyOnceWith(job);
    expect(moveToActive).toHaveBeenCalledOnce();
    expect(child.isPaused()).toBe(true);
  });

  it('uses installed pause admission semantics, including mainLoop refusing new fetches', async () => {
    const worker = localWorker('paused');
    const active = deferred();
    Reflect.set(worker, 'mainLoopRunning', active.promise);
    const moveToActive = vi.fn();
    Reflect.set(worker, 'moveToActive', moveToActive);
    const paused = worker.pause();
    expect(worker.isPaused()).toBe(true);
    expect(await worker.getNextJob('token', { block: false })).toBeUndefined();
    const mainLoop: (client: object, blocking: object) => Promise<void> = Reflect.get(
      worker,
      'mainLoop'
    );
    await mainLoop.call(worker, {}, {});
    expect(moveToActive).not.toHaveBeenCalled();
    active.resolve();
    await paused;
  });

  it('still pauses a dependent consumer after a producer pause fails', async () => {
    const error = new Error('producer pause failed');
    const parent = {
      name: 'parent',
      pause: vi.fn(async () => {
        throw error;
      }),
    };
    const child = { name: 'child', pause: vi.fn(async () => undefined) };
    @Processor('parent', {}, ['child'])
    class ParentHost extends TestHost {}
    const discovery = appWith([new ParentHost(parent), new TestHost(child)]).get(
      'discovery'
    ) as DiscoveryService;
    expect(await Promise.allSettled(pauseQueueWorkers(discovery))).toEqual([
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: undefined },
    ]);
    expect(child.pause).toHaveBeenCalledOnce();
  });

  it('force closes abandoned jobs so the later Nest close cannot await them again', async () => {
    const worker = localWorker('abandoned');
    const active = deferred();
    Reflect.set(worker, 'mainLoopRunning', active.promise);
    const whenCurrentJobsFinished: () => Promise<void> = Reflect.get(
      worker,
      'whenCurrentJobsFinished'
    );
    const waitForActive = vi.fn(whenCurrentJobsFinished.bind(worker));
    Reflect.set(worker, 'whenCurrentJobsFinished', waitForActive);
    const discovery = appWith([new TestHost(worker), new TestHost(worker)]).get(
      'discovery'
    ) as DiscoveryService;

    await Promise.all(forceCloseQueueWorkers(discovery));
    // This is the unforced call made later by Nest BullExplorer's onApplicationShutdown.
    await worker.close();
    expect(waitForActive).not.toHaveBeenCalled();
    expect(worker.isRunning()).toBe(false);
    active.resolve();
  });

  it('returns force close failures without skipping other workers', async () => {
    const error = new Error('close failed');
    const failed = {
      close: vi.fn(() => {
        throw error;
      }),
    };
    const other = { close: vi.fn(async () => undefined) };
    const discovery = appWith([new TestHost(failed), new TestHost(other)]).get(
      'discovery'
    ) as DiscoveryService;
    const closes = forceCloseQueueWorkers(discovery);
    expect(other.close).toHaveBeenCalledExactlyOnceWith(true);
    expect(await Promise.allSettled(closes)).toEqual([
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: undefined },
    ]);
  });
});
