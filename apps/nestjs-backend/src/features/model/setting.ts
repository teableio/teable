import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IPerformanceCacheStore } from '../../performance-cache';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateSettingCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';
import { clearCache } from './helper';

export function parseSettingContent(content: string | null): unknown {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

@Injectable()
export class SettingModel {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly performanceCacheService: PerformanceCacheService,
    private readonly cls: ClsService<IClsStore>
  ) {
    this.prismaService.$use(async (params, next) => {
      const clearCacheKeys: (keyof IPerformanceCacheStore)[] = [];
      if (
        params.model === 'Setting' &&
        (params.action.includes('update') ||
          params.action.includes('delete') ||
          params.action.includes('upsert') ||
          params.action.includes('create'))
      ) {
        clearCacheKeys.push(generateSettingCacheKey());
      }

      await clearCache(params, clearCacheKeys, this.performanceCacheService, this.cls);
      return next(params);
    });
  }

  @PerformanceCache({
    ttl: 60 * 60 * 24, // 1 day
    keyGenerator: generateSettingCacheKey,
    statsType: 'instance:setting',
  })
  async getSetting() {
    const rows = await this.prismaService.setting.findMany();
    return rows.map((row) => ({
      ...row,
      content: parseSettingContent(row.content),
    }));
  }
}
