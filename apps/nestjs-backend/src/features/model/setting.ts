import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICanaryConfig } from '@teable/openapi';
import { SettingKey } from '@teable/openapi';
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

/** Never put canary spaceIds in the shared setting Redis blob — list can be huge. */
export function stripCanarySpaceIdsFromSettingCache(name: string, content: unknown): unknown {
  if (name !== SettingKey.CANARY_CONFIG) {
    return content;
  }
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return content;
  }
  return {
    ...(content as Record<string, unknown>),
    spaceIds: [],
  };
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

      const result = await next(params);
      await clearCache(params, clearCacheKeys, this.performanceCacheService, this.cls);
      return result;
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
      content: stripCanarySpaceIdsFromSettingCache(row.name, parseSettingContent(row.content)),
    }));
  }

  /** Full canaryConfig including spaceIds — always from DB, never the stripped setting cache. */
  async getCanaryConfigFromDb(): Promise<ICanaryConfig | null> {
    const row = await this.prismaService.setting.findUnique({
      where: { name: SettingKey.CANARY_CONFIG },
      select: { content: true },
    });
    const content = parseSettingContent(row?.content ?? null);
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      return null;
    }
    return content as ICanaryConfig;
  }
}
