import { ServiceUnavailableException } from '@nestjs/common';
import { domainError, type DomainError } from '@teable/v2-core';
import { ok, err, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { throwV2Error } from '../../v2/v2-http-error';
import { AggregationOpenApiV2Service } from './aggregation-open-api-v2.service';
import { AggregationOpenApiController } from './aggregation-open-api.controller';

describe('community aggregation readiness wiring', () => {
  it('rebuilds cache keys after probe wait and hydrates only in the loader', async () => {
    let version = 1;
    const meta = vi.fn(async () => ({ lastModifiedTime: new Date(version) }));
    const query = vi.fn(async () => ({ rowCount: 9 }));
    const cache = {
      get: vi.fn(async (_key: string) => null),
      wrap: vi.fn(async (_key: string, load: () => Promise<unknown>) => load()),
    };
    const controller: AggregationOpenApiController = Object.assign(
      Object.create(AggregationOpenApiController.prototype),
      {
        prismaService: { tableMeta: { findUniqueOrThrow: meta } },
        cls: { get: (key: string) => key === 'useV2' },
        performanceCacheService: cache,
        aggregationOpenApiV2Service: {
          getRowCount: query,
          withProvisionReadyCache: async (
            _id: string,
            getCached: () => Promise<unknown>,
            load: () => Promise<unknown>
          ) => {
            await getCached();
            expect(query).not.toHaveBeenCalled();
            version = 2;
            return load();
          },
        },
      }
    );
    expect(await controller.getRowCount('table', {})).toEqual({ rowCount: 9 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(meta).toHaveBeenCalledTimes(2);
    expect(cache.wrap.mock.calls[0][0]).not.toEqual(cache.get.mock.calls[0]?.[0]);
  });
});

// Real controller + readiness service; cache lock and database are controlled fakes.
// This checks orchestration, not Redis mutual exclusion or PostgreSQL query shapes.
describe('cache/readiness composition', () => {
  const fixture = () => {
    let version = 1;
    let locked = false;
    const pending = domainError.infrastructure({
      code: 'table.provision_pending',
      message: 'Schema updating (provision_state=pending)',
    });
    const waitForReady = vi.fn<() => Promise<Result<void, DomainError>>>(async () => {
      expect(locked).toBe(false);
      return ok(undefined);
    });
    const service = new AggregationOpenApiV2Service(
      { getContainerForTable: async () => ({ resolve: () => ({ waitForReady }) }) } as never,
      { createContext: async () => ({}) } as never,
      {} as never,
      undefined
    );
    const cache = {
      get: vi.fn(
        async (_key: string, _options?: unknown): Promise<{ data: number } | null> => null
      ),
      wrap: vi.fn(async (_key: string, load: () => Promise<number>) => {
        locked = true;
        try {
          return await load();
        } finally {
          locked = false;
        }
      }),
    };
    const controller = Object.assign(Object.create(AggregationOpenApiController.prototype), {
      prismaService: {
        tableMeta: { findUniqueOrThrow: async () => ({ lastModifiedTime: new Date(version) }) },
      },
      cls: { get: (key: string) => key === 'useV2' },
      performanceCacheService: cache,
      aggregationOpenApiV2Service: service,
    }) as {
      getAggregationWithCache(
        prefix: string,
        id: string,
        query: object | undefined,
        load: () => Promise<number>
      ): Promise<number>;
    };
    const load = vi.fn(async () => 9);
    return {
      cache,
      waitForReady,
      pending,
      load,
      setVersion: (value: number) => {
        version = value;
      },
      run: () => controller.getAggregationWithCache('row_count', `tbl${'a'.repeat(16)}`, {}, load),
    };
  };

  it('keeps 100 pending requests outside the lock through the real readiness service', async () => {
    const f = fixture();
    let release!: () => void;
    let allWaiting!: () => void;
    const waiting = new Promise<void>((resolve) => {
      allWaiting = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let count = 0;
    f.waitForReady.mockImplementation(async () => {
      if (++count === 100) allWaiting();
      await gate;
      return err(f.pending);
    });
    const requests = Array.from({ length: 100 }, () => f.run().catch((error) => error));
    await waiting;
    expect(f.cache.wrap).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
    release();
    const results = await Promise.all(requests);
    expect(results).toHaveLength(100);
    for (const result of results) expect(result.data.domainCode).toBe('table.provision_pending');
    expect(f.cache.wrap).not.toHaveBeenCalled();
  });

  it('releases the loader lock before retrying pending and rebuilding the key', async () => {
    const f = fixture();
    f.load.mockImplementationOnce(async () => {
      f.setVersion(2);
      throwV2Error(f.pending, 503);
    });
    expect(await f.run()).toBe(9);
    expect(f.waitForReady).toHaveBeenCalledTimes(2);
    expect(f.cache.wrap.mock.calls[1][0]).not.toEqual(f.cache.wrap.mock.calls[0][0]);
  });

  it('does not retry actual lock-busy exceptions as pending', async () => {
    const f = fixture();
    const busy = new ServiceUnavailableException('Query is busy');
    f.cache.wrap.mockRejectedValue(busy);
    await expect(f.run()).rejects.toBe(busy);
    expect(f.waitForReady).toHaveBeenCalledTimes(1);
    expect(f.cache.wrap).toHaveBeenCalledTimes(1);
    expect(f.load).not.toHaveBeenCalled();
  });

  it('returns cache hits without readiness or locking', async () => {
    const f = fixture();
    f.cache.get.mockResolvedValue({ data: 42 });
    expect(await f.run()).toBe(42);
    expect(f.waitForReady).not.toHaveBeenCalled();
    expect(f.cache.wrap).not.toHaveBeenCalled();
  });
});
