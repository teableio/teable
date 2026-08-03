import { Injectable, Logger } from '@nestjs/common';
import { IdPrefix, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITemplatePermalinkVo } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateTemplatePermalinkCacheKey } from '../../performance-cache/generate-keys';

@Injectable()
export class TemplatePermalinkService {
  private logger = new Logger(TemplatePermalinkService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  @PerformanceCache({
    ttl: 86400, // 1 day (24 hours)
    keyGenerator: (identifier: string) => generateTemplatePermalinkCacheKey(identifier),
  })
  async resolvePermalink(identifier: string): Promise<ITemplatePermalinkVo> {
    const prisma = this.prismaService.txClient();

    if (!identifier.startsWith(IdPrefix.Template)) {
      throw new CustomHttpException('Invalid identifier', HttpErrorCode.NOT_FOUND);
    }

    // 1. Find template by ID
    const template = await prisma.template.findUnique({
      where: { id: identifier },
      select: {
        publishInfo: true,
        snapshot: true,
        isPublished: true,
        id: true,
      },
    });

    // 2. Validate template exists
    if (!template) {
      throw new CustomHttpException('Template not found', HttpErrorCode.NOT_FOUND);
    }

    // 3. Check if template is published
    if (!template.isPublished) {
      throw new CustomHttpException('Template is not published', HttpErrorCode.RESTRICTED_RESOURCE);
    }

    // 4. Parse snapshot and publishInfo
    const snapshot = template.snapshot ? JSON.parse(template.snapshot) : {};
    const publishInfo = template.publishInfo as { defaultUrl?: string } | null;
    const snapshotBaseId = snapshot.baseId;

    if (!snapshotBaseId) {
      throw new CustomHttpException(
        'Template snapshot is invalid',
        HttpErrorCode.UNPROCESSABLE_ENTITY
      );
    }

    // 5. Get redirect URL from publishInfo, fallback to base homepage
    const defaultUrl = publishInfo?.defaultUrl;
    const redirectUrl = defaultUrl || `/base/${snapshotBaseId}`;

    return {
      redirectUrl,
    };
  }
}
