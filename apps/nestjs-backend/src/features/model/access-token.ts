import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateAccessTokenCacheKey } from '../../performance-cache/generate-keys';

@Injectable()
export class AccessTokenModel {
  constructor(
    private readonly prismaService: PrismaService,
    protected readonly performanceCacheService: PerformanceCacheService
  ) {}

  @PerformanceCache({
    ttl: 60 * 5,
    keyGenerator: generateAccessTokenCacheKey,
    statsType: 'access-token',
  })
  async getAccessTokenRawById(id: string) {
    return await this.prismaService.txClient().accessToken.findUnique({
      where: { id },
    });
  }
}
