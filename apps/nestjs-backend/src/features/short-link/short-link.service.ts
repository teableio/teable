import { Injectable, Logger } from '@nestjs/common';
import { getRandomString, HttpErrorCode } from '@teable/core';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import type { ICreateShortLinkRo, IShortLinkVo } from '@teable/openapi';
import { ShortLinkType } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateShortLinkCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';

const SHORT_LINK_CODE_LENGTH = 9;
const SHORT_LINK_CODE_MAX_RETRY = 5;

@Injectable()
export class ShortLinkService {
  private logger = new Logger(ShortLinkService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  /**
   * Derive the current target path of a resource, validating that it is still
   * accessible. Resolution happens at redirect time, so revoking a resource
   * (disabling a share, unpublishing a template) invalidates its short link
   * immediately.
   */
  private async resolveTargetPath(type: ShortLinkType, resourceId: string): Promise<string> {
    const prisma = this.prismaService.txClient();
    switch (type) {
      case ShortLinkType.ViewShare: {
        const view = await prisma.view.findFirst({
          where: { shareId: resourceId, enableShare: true, deletedTime: null },
          select: { id: true },
        });
        if (!view) {
          throw new CustomHttpException('Share view not found', HttpErrorCode.NOT_FOUND);
        }
        return `/share/${resourceId}/view`;
      }
      case ShortLinkType.BaseShare: {
        const baseShare = await prisma.baseShare.findFirst({
          where: { shareId: resourceId, enabled: true },
          select: { id: true },
        });
        if (!baseShare) {
          throw new CustomHttpException('Base share not found', HttpErrorCode.NOT_FOUND);
        }
        return `/share/${resourceId}/base`;
      }
      case ShortLinkType.Template: {
        const template = await prisma.template.findFirst({
          where: { id: resourceId, isPublished: true },
          select: { id: true },
        });
        if (!template) {
          throw new CustomHttpException('Template not found', HttpErrorCode.NOT_FOUND);
        }
        // the /t page performs the template permalink resolution itself
        return `/t/${resourceId}`;
      }
      default:
        throw new CustomHttpException(
          'Unsupported short link type',
          HttpErrorCode.VALIDATION_ERROR
        );
    }
  }

  private async insertShortLink(type: ShortLinkType, resourceId: string): Promise<string> {
    const prisma = this.prismaService.txClient();
    const userId = this.cls.get('user.id');
    for (let retry = 0; retry < SHORT_LINK_CODE_MAX_RETRY; retry++) {
      const code = getRandomString(SHORT_LINK_CODE_LENGTH);
      try {
        const created = await prisma.shortLink.create({
          data: { code, type, resourceId, createdBy: userId },
          select: { code: true },
        });
        return created.code;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        const target = (error.meta?.target as string[] | undefined)?.join(',');
        if (target?.includes('code')) {
          // code collision, generate a new one
          this.logger.warn(`Short link code collision, retrying (${retry + 1})`);
          continue;
        }
        const reused = await this.reuseExistingShortLink(type, resourceId);
        if (reused) {
          return reused;
        }
        throw error;
      }
    }
    throw new CustomHttpException(
      'Failed to generate short link code',
      HttpErrorCode.INTERNAL_SERVER_ERROR
    );
  }

  /**
   * On a (type, resourceId) unique conflict: reuse the concurrently created row,
   * or revive a row previously marked deleted whose resource is valid again (the
   * caller already validated the resource via resolveTargetPath).
   */
  private async reuseExistingShortLink(
    type: ShortLinkType,
    resourceId: string
  ): Promise<string | null> {
    const prisma = this.prismaService.txClient();
    const existing = await prisma.shortLink.findFirst({
      where: { type, resourceId },
      select: { code: true, deletedTime: true },
    });
    if (!existing) {
      return null;
    }
    if (existing.deletedTime) {
      await prisma.shortLink.update({
        where: { code: existing.code },
        data: { deletedTime: null },
      });
      await this.performanceCacheService.del(generateShortLinkCacheKey(existing.code));
    }
    return existing.code;
  }

  async createShortLink(createShortLinkRo: ICreateShortLinkRo): Promise<IShortLinkVo> {
    const { type, resourceId } = createShortLinkRo;
    const path = await this.resolveTargetPath(type, resourceId);

    const existed = await this.prismaService.txClient().shortLink.findFirst({
      where: { type, resourceId, deletedTime: null },
      select: { code: true },
    });
    if (existed) {
      return { code: existed.code, path };
    }

    const code = await this.insertShortLink(type, resourceId);
    return { code, path };
  }

  @PerformanceCache({
    // short TTL so that revoking the target resource (e.g. disabling a share)
    // takes effect quickly while still absorbing read bursts
    ttl: 60,
    keyGenerator: (code: string) => generateShortLinkCacheKey(code),
  })
  async getShortLink(code: string): Promise<IShortLinkVo> {
    const shortLink = await this.prismaService.txClient().shortLink.findUnique({
      where: { code, deletedTime: null },
      select: { code: true, type: true, resourceId: true },
    });
    if (!shortLink) {
      throw new CustomHttpException('Short link not found', HttpErrorCode.NOT_FOUND);
    }
    const path = await this.resolveTargetPath(
      shortLink.type as ShortLinkType,
      shortLink.resourceId
    );
    return { code: shortLink.code, path };
  }

  /**
   * Mark short links as deleted when their target resource is permanently
   * invalidated (shareId rotated, resource hard-deleted). Do NOT call this for
   * temporary revocations (disabling a share, unpublishing a template) — those
   * resources can come back, and their short links should come back with them.
   *
   * The marker is advisory (for auditing and future cleanup); link validity is
   * still enforced by redirect-time resolution.
   */
  async markDeletedByResource(type: ShortLinkType, resourceId: string): Promise<void> {
    try {
      // Deliberately use the root client, NOT txClient(): if these queries ran
      // inside the caller's ambient transaction, a failure here would abort
      // that transaction even though we swallow the exception below
      const prisma = this.prismaService;
      const links = await prisma.shortLink.findMany({
        where: { type, resourceId, deletedTime: null },
        select: { code: true },
      });
      // Most resources never had a short link (they are created on demand);
      // bail out without touching anything
      if (links.length === 0) {
        return;
      }
      await prisma.shortLink.updateMany({
        where: { type, resourceId, deletedTime: null },
        data: { deletedTime: new Date() },
      });
      await Promise.all(
        links.map((link) => this.performanceCacheService.del(generateShortLinkCacheKey(link.code)))
      );
    } catch (error) {
      // Advisory bookkeeping must never fail the caller's main operation;
      // an unmarked row is harmless (validity is enforced at redirect time)
      this.logger.warn(
        `Failed to mark short links deleted for ${type}:${resourceId}: ${(error as Error).message}`
      );
    }
  }
}
