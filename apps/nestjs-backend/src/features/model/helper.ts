import type { Prisma } from '@teable/db-main-prisma';
import type { ClsService } from 'nestjs-cls';
import type { IPerformanceCacheStore, PerformanceCacheService } from '../../performance-cache';
import type { IClsStore } from '../../types/cls';

/** Queue keys for the after-commit flush in the `bindAfterTransaction` callback. */
export const queueClearCacheKeys = (
  cls: ClsService<IClsStore>,
  keys: (keyof IPerformanceCacheStore)[]
) => {
  const currentClearCacheKeys = cls.get('clearCacheKeys') || [];
  cls.set('clearCacheKeys', [...currentClearCacheKeys, ...keys]);
};

export const clearCache = async (
  params: Prisma.MiddlewareParams,
  clearCacheKeys: (keyof IPerformanceCacheStore)[],
  performanceCacheService: PerformanceCacheService,
  cls: ClsService<IClsStore>
) => {
  if (!clearCacheKeys.length) {
    return;
  }

  // Always defer invalidation until after the write. Deleting before `next()`
  // opens a window where a concurrent reader can refill Redis with the old
  // row; for long-TTL keys (e.g. instance settings) that stale blob then
  // survives until expiry.
  if (params.runInTransaction && cls.isActive()) {
    queueClearCacheKeys(cls, clearCacheKeys);
    return;
  }

  await Promise.all(clearCacheKeys.map((key) => performanceCacheService.del(key)));
};
