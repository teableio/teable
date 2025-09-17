import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateSettingCacheKey } from '../../performance-cache/generate-keys';

@Injectable()
export class SettingModel {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  @PerformanceCache({
    ttl: 60 * 60 * 24, // 1 day
    keyGenerator: generateSettingCacheKey,
    statsType: 'instance:setting',
  })
  async getSetting() {
    return await this.prismaService.txClient().setting.findMany();
  }
}
