import { Injectable, Logger } from '@nestjs/common';
import { IdPrefix, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITemplatePermalinkVo } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateTemplatePermalinkCacheKey } from '../../performance-cache/generate-keys';
import { resolveTemplateRedirectUrl } from './template-permalink.helper';

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
    if (!identifier.startsWith(IdPrefix.Template)) {
      throw new CustomHttpException('Invalid identifier', HttpErrorCode.NOT_FOUND);
    }

    const redirectUrl = await resolveTemplateRedirectUrl(this.prismaService.txClient(), identifier);

    return {
      redirectUrl,
    };
  }
}
