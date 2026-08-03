import type { Prisma } from '@teable/db-main-prisma';
import type { ClsService } from 'nestjs-cls';
import type { IPerformanceCacheStore, PerformanceCacheService } from '../../performance-cache';
import type { IClsStore } from '../../types/cls';

export const clearCache = async (
  params: Prisma.MiddlewareParams,
  clearCacheKeys: (keyof IPerformanceCacheStore)[],
  performanceCacheService: PerformanceCacheService,
  cls: ClsService<IClsStore>
) => {
  if (!clearCacheKeys.length) {
    return;
  }
  if (!params.runInTransaction) {
    await Promise.all(clearCacheKeys.map((key) => performanceCacheService.del(key)));
    return;
  }

  if (cls.isActive()) {
    const currentClearCacheKeys = cls.get('clearCacheKeys') || [];
    cls.set('clearCacheKeys', [...currentClearCacheKeys, ...clearCacheKeys]);
  }
};
