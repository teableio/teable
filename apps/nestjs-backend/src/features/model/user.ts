import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IPerformanceCacheStore } from '../../performance-cache';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateUserCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';
import { dateToIso } from '../../utils/date-to-iso';

@Injectable()
export class UserModel {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly performanceCacheService: PerformanceCacheService,
    private readonly cls: ClsService<IClsStore>
  ) {
    this.prismaService.$use(async (params, next) => {
      const clearCacheKeys: (keyof IPerformanceCacheStore)[] = [];
      if (
        params.model === 'User' &&
        (params.action.includes('update') || params.action.includes('delete'))
      ) {
        const whereId = params.args?.where?.id;
        whereId && clearCacheKeys.push(generateUserCacheKey(whereId));
      }
      if (!clearCacheKeys.length) {
        return next(params);
      }
      if (!params.runInTransaction) {
        await Promise.all(clearCacheKeys.map((key) => this.performanceCacheService.del(key)));
        return next(params);
      }
      if (this.cls.isActive()) {
        const currentClearCacheKeys = this.cls.get('clearCacheKeys') || [];
        this.cls.set('clearCacheKeys', [...currentClearCacheKeys, ...clearCacheKeys]);
      }
      return next(params);
    });
  }

  @PerformanceCache({
    ttl: 30,
    keyGenerator: generateUserCacheKey,
    preventConcurrent: false,
    statsType: 'user',
  })
  async getUserRawById(id: string) {
    const res = await this.prismaService.txClient().user.findUnique({
      where: { id, deletedTime: null },
    });
    if (!res) {
      return null;
    }
    return dateToIso(res);
  }
}
