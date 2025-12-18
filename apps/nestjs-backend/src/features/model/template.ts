import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITemplateVo } from '@teable/openapi';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateTemplateCacheKeyByBaseId } from '../../performance-cache/generate-keys';

@Injectable()
export class TemplateModel {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  @PerformanceCache({
    ttl: 60 * 60 * 24, // 1 day
    keyGenerator: (baseId: string) => generateTemplateCacheKeyByBaseId(baseId),
    statsType: 'template',
  })
  async getTemplateRawByBaseId(baseId: string) {
    const res = await this.prismaService.txClient().template.findFirst({
      where: { snapshot: { contains: baseId } },
    });
    if (!res) {
      return null;
    }
    return {
      ...res,
      snapshot: JSON.parse(res.snapshot!) as ITemplateVo['snapshot'],
    };
  }
}
