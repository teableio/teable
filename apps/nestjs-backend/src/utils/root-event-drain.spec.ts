import 'reflect-metadata';

import type { Server } from 'node:http';
import { WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { DiscoveryService } from '@nestjs/core';
import type { Worker } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { drainRootEvents } from './root-event-drain';

class LocalWorker extends WorkerHost {
  constructor(worker: Partial<Worker>) {
    super();
    Reflect.set(this, '_worker', worker);
  }

  async process() {}
}

const discover = (workers: Partial<Worker>[] = []) =>
  ({ getProviders: vi.fn(() => workers.map((worker) => ({ instance: new LocalWorker(worker) }))) }) as unknown as DiscoveryService;

describe('drainRootEvents', () => {
  it('reuses the gate without creating more producers, including after completion', async () => {
    const container = { drainEvents: vi.fn(async (producers: ReadonlyArray<Promise<void>> = []) => {
      await Promise.all(producers);
      return true;
    }) };
    const reconciliation = { stop: vi.fn(async () => undefined) };
    const discovery = discover();
    const first = drainRootEvents(container, undefined, discovery, reconciliation);
    expect(drainRootEvents(container, undefined, discovery, reconciliation)).toBe(first);
    await first;
    expect(drainRootEvents(container, undefined, discovery, reconciliation)).toBe(first);
    expect(discovery.getProviders).toHaveBeenCalledOnce();
    expect(reconciliation.stop).toHaveBeenCalledOnce();
    expect(container.drainEvents).toHaveBeenCalledOnce();
  });

  it.each(['timeout', 'rejection'] as const)(
    'force closes all workers and reports an unsuccessful drain (%s)',
    async (outcome) => {
      const error = new Error('drain failed');
      const closeError = new Error('force close failed');
      const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const worker = { pause: vi.fn(async () => undefined), close: vi.fn(async () => { throw closeError; }) };
      const other = { pause: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
      const container = { drainEvents: vi.fn(async (producers: ReadonlyArray<Promise<void>> = []) => {
        await Promise.all(producers);
        if (outcome === 'rejection') throw error;
        return false;
      }) };
      const reconciliation = { stop: vi.fn(async () => undefined) };
      try {
        await drainRootEvents(container, undefined, discover([worker, other]), reconciliation);
        expect(worker.close).toHaveBeenCalledExactlyOnceWith(true);
        expect(other.close).toHaveBeenCalledExactlyOnceWith(true);
        expect(log).toHaveBeenCalledWith(
          'Event drain did not finish; force closing queue workers before dependency teardown'
        );
        expect(log).toHaveBeenCalledWith('Force closing queue worker failed', closeError);
        if (outcome === 'rejection') expect(log).toHaveBeenCalledWith('Event drain failed', error);
      } finally {
        log.mockRestore();
      }
    }
  );

  it('passes HTTP close errors to the shared drain rather than treating them as success', async () => {
    const error = new Error('HTTP close failed');
    const server = { close: (callback: (error: Error) => void) => callback(error) } as unknown as Server;
    const container = { drainEvents: vi.fn(async (producers: ReadonlyArray<Promise<void>> = []) => {
      const outcomes = await Promise.allSettled(producers);
      expect(outcomes[0]).toEqual({ status: 'rejected', reason: error });
      return false;
    }) };
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      await drainRootEvents(container, server, discover(), { stop: async () => undefined });
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
