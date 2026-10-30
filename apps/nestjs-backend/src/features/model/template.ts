import { Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import type { ITemplateHistoryEntry, ITemplateVo } from '@teable/openapi';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateTemplateCacheKeyByBaseId } from '../../performance-cache/generate-keys';

/**
 * Listed in the catalogue: published through a review (history) or promoted by an admin
 * (featured). Built on demand: specs load this module with the Prisma client mocked away.
 */
export const listedTemplateWhere = (): Prisma.TemplateWhereInput => ({
  isPublished: true,
  OR: [{ featured: true }, { history: { not: Prisma.DbNull } }],
});

/** The public routes take the id or the slug: the official site links templates by slug. */
export const templateIdOrSlugWhere = (identifier: string): Prisma.TemplateWhereInput => ({
  OR: [{ id: identifier }, { slug: identifier }],
});

/** A listing published outside the review flow starts its history here. */
export const firstPublishHistory = (version: number): ITemplateHistoryEntry[] => [
  { version, publishedTime: new Date().toISOString() },
];

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

  /** The template whose pending submission froze this base. */
  async getPendingTemplateRawByBaseId(baseId: string) {
    return this.prismaService.txClient().template.findFirst({
      where: { review: { path: ['snapshotBaseId'], equals: baseId } },
      select: { id: true },
    });
  }
}
