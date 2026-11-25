import { Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import { TemplateReviewStatus } from '@teable/openapi';
import type { ITemplateHistoryEntry, ITemplateVo } from '@teable/openapi';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateTemplateCacheKeyByBaseId } from '../../performance-cache/generate-keys';

/**
 * Listed in the catalogue where publishing lists a template (the community edition): published
 * through the publish flow (it has a history) or promoted by an admin (featured); templates
 * published before histories existed stay hidden unless featured. Where a review lists templates
 * (EE) the catalogue is what is featured instead. Built on demand: specs load this module with
 * the Prisma client mocked away. Whether the template is out at all is `liveTemplateWhere`.
 */
export const listedTemplateWhere = (): Prisma.TemplateWhereInput => ({
  isPublished: true,
  OR: [{ featured: true }, { history: { not: Prisma.DbNull } }],
});

/** Published, listed or not: the rows `isTemplateLive` tells apart one by one. */
export const liveTemplateWhere = (): Prisma.TemplateWhereInput => ({
  snapshot: { not: null },
  OR: [{ isPublished: true }, { history: { not: Prisma.DbNull } }],
});

/** The rows `isUnreleasedSubmission` tells apart one by one. */
export const unreleasedSubmissionWhere = (): Prisma.TemplateWhereInput => ({
  snapshot: null,
  review: { path: ['status'], equals: TemplateReviewStatus.Review },
});

/** The public routes take the id or the slug: the official site links templates by slug. */
export const templateIdOrSlugWhere = (identifier: string): Prisma.TemplateWhereInput => ({
  OR: [{ id: identifier }, { slug: identifier }],
});

/**
 * How long the template lookups stay cached. The publish and admin flows clear them; this only
 * bounds how long a stale answer survives anything those clears miss.
 */
export const TEMPLATE_CACHE_TTL = 60 * 60;

/** A listing published outside the review flow starts its history here. */
export const firstPublishHistory = (version: number): ITemplateHistoryEntry[] => [
  { version, publishedTime: new Date().toISOString() },
];

/**
 * The row whose snapshot base is `baseId`, with its snapshot parsed. The snapshot column is a
 * JSON string that also carries the snapshot base's name, which the publisher chooses, so a
 * row containing the id is only a candidate: the id has to be the snapshot's own base.
 */
export const pickTemplateOfSnapshotBase = <T extends { snapshot: string | null }>(
  rows: readonly T[],
  baseId: string
): (Omit<T, 'snapshot'> & { snapshot: ITemplateVo['snapshot'] }) | null => {
  for (const row of rows) {
    if (!row.snapshot) continue;
    let snapshot: ITemplateVo['snapshot'];
    try {
      snapshot = JSON.parse(row.snapshot) as ITemplateVo['snapshot'];
    } catch {
      continue;
    }
    if (snapshot?.baseId === baseId) {
      return { ...row, snapshot };
    }
  }
  return null;
};

@Injectable()
export class TemplateModel {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  @PerformanceCache({
    ttl: TEMPLATE_CACHE_TTL,
    keyGenerator: (baseId: string) => generateTemplateCacheKeyByBaseId(baseId),
    statsType: 'template',
  })
  async getTemplateRawByBaseId(baseId: string) {
    const candidates = await this.prismaService.txClient().template.findMany({
      where: { snapshot: { contains: baseId } },
    });
    return pickTemplateOfSnapshotBase(candidates, baseId);
  }

  /**
   * The template whose submission, still waiting for review, froze this base. A refused or
   * withdrawn submission keeps its snapshot id on the row, but its snapshot is retired.
   */
  async getPendingTemplateRawByBaseId(baseId: string) {
    const template = await this.prismaService.txClient().template.findFirst({
      where: { review: { path: ['snapshotBaseId'], equals: baseId } },
      select: { id: true, isPublished: true, snapshot: true, review: true },
    });
    const status = (template?.review as { status?: string } | null | undefined)?.status;
    return template && status === TemplateReviewStatus.Review
      ? {
          id: template.id,
          // never live: no snapshot was ever published for it
          firstSubmission: !template.isPublished && !template.snapshot,
        }
      : null;
  }
}
