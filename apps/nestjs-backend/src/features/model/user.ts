import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IPerformanceCacheStore } from '../../performance-cache';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateUserCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';
import { dateToIso } from '../../utils/date-to-iso';
import { clearCache } from './helper';

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
      await clearCache(params, clearCacheKeys, this.performanceCacheService, this.cls);
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
