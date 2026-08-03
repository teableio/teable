import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateAccessTokenCacheKey } from '../../performance-cache/generate-keys';
import { dateToIso } from '../../utils/date-to-iso';

@Injectable()
export class AccessTokenModel {
  constructor(
    private readonly prismaService: PrismaService,
    protected readonly performanceCacheService: PerformanceCacheService
  ) {}

  @PerformanceCache({
    ttl: 30,
    keyGenerator: generateAccessTokenCacheKey,
    statsType: 'access-token',
  })
  async getAccessTokenRawById(id: string) {
    const res = await this.prismaService.txClient().accessToken.findUnique({
      where: { id },
    });
    if (!res) {
      return null;
    }
    return dateToIso(res);
  }
}
