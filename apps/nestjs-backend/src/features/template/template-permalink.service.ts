import { Injectable, Logger } from '@nestjs/common';
import { IdPrefix, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITemplatePermalinkVo } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';

@Injectable()
export class TemplatePermalinkService {
  private logger = new Logger(TemplatePermalinkService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async resolvePermalink(identifier: string): Promise<ITemplatePermalinkVo> {
    const prisma = this.prismaService.txClient();
    let template;

    // 1. Try to find by template ID (primary key - fastest)
    if (identifier.startsWith(IdPrefix.Template)) {
      template = await prisma.template.findUnique({
        where: { id: identifier },
      });
    }

    // 2. If not found and not a template ID, try to find by shortcode
    if (!template) {
      template = await prisma.template.findUnique({
        where: { shortcode: identifier },
      });
    }

    // 3. Template not found
    if (!template) {
      throw new CustomHttpException('Template not found', HttpErrorCode.NOT_FOUND);
    }

    // 4. Check if template is published
    if (!template.isPublished) {
      throw new CustomHttpException('Template is not published', HttpErrorCode.RESTRICTED_RESOURCE);
    }

    // 5. Parse snapshot and publishInfo
    const snapshot = template.snapshot ? JSON.parse(template.snapshot) : {};
    const publishInfo = template.publishInfo as { defaultUrl?: string } | null;
    const snapshotBaseId = snapshot.baseId;

    if (!snapshotBaseId) {
      throw new CustomHttpException(
        'Template snapshot is invalid',
        HttpErrorCode.UNPROCESSABLE_ENTITY
      );
    }

    // 6. Get redirect URL from publishInfo, fallback to base homepage
    const defaultUrl = publishInfo?.defaultUrl;
    const redirectUrl = defaultUrl || `/base/${snapshotBaseId}`;

    // 7. Build permalink
    const permalink = `/t/${template.id}`;

    return {
      templateId: template.id,
      redirectUrl,
      snapshotBaseId,
      permalink,
      shortcode: template.shortcode || undefined,
    };
  }

  private async getTemplateById(templateId: string) {
    const prisma = this.prismaService.txClient();
    return prisma.template.findUnique({
      where: { id: templateId },
    });
  }

  private async getTemplateByShortcode(shortcode: string) {
    const prisma = this.prismaService.txClient();
    return prisma.template.findUnique({
      where: { shortcode },
    });
  }
}
