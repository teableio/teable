import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateUserCacheKey } from '../../performance-cache/generate-keys';
import { dateToIso } from '../../utils/date-to-iso';

@Injectable()
export class UserModel {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly performanceCacheService: PerformanceCacheService
  ) {
    this.prismaService.$use(async (params, next) => {
      if (
        params.model === 'User' &&
        (params.action.includes('update') || params.action.includes('delete'))
      ) {
        const whereId = params.args?.where?.id;
        whereId && (await this.performanceCacheService.del(generateUserCacheKey(whereId)));
      }
      return next(params);
    });
  }

  @PerformanceCache({
    ttl: 60 * 5,
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
