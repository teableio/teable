import type { Prisma } from '@teable/db-main-prisma';
import type { ClsService } from 'nestjs-cls';
import type { PerformanceCacheService } from '../../performance-cache';
import type { IClsStore } from '../../types/cls';
import { clearCache } from './helper';

describe('clearCache', () => {
  it('deletes immediately when the write is not in a transaction', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const cls = {
      isActive: () => false,
      get: vi.fn(),
      set: vi.fn(),
    };

    await clearCache(
      { runInTransaction: false } as Prisma.MiddlewareParams,
      ['instance:setting:v3'],
      { del } as unknown as PerformanceCacheService,
      cls as unknown as ClsService<IClsStore>
    );

    expect(del).toHaveBeenCalledWith('instance:setting:v3');
    expect(cls.set).not.toHaveBeenCalled();
  });

  it('queues keys for after-commit flush when the write is in a transaction', async () => {
    const del = vi.fn();
    const store: { clearCacheKeys?: string[] } = { clearCacheKeys: ['user:u1'] };
    const cls = {
      isActive: () => true,
      get: (key: string) => store[key as keyof typeof store],
      set: (key: string, value: unknown) => {
        store[key as keyof typeof store] = value as string[];
      },
    };

    await clearCache(
      { runInTransaction: true } as Prisma.MiddlewareParams,
      ['instance:setting:v3'],
      { del } as unknown as PerformanceCacheService,
      cls as unknown as ClsService<IClsStore>
    );

    expect(del).not.toHaveBeenCalled();
    expect(store.clearCacheKeys).toEqual(['user:u1', 'instance:setting:v3']);
  });
});
