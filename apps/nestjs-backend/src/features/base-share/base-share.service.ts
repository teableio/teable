import { Injectable } from '@nestjs/common';
import { generateShareId, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateBaseShareRo, IUpdateBaseShareRo, IBaseShareVo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateBaseShareListCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';

const baseShareNotFoundMessage = 'Base share not found';
const baseShareNotFoundKey = 'httpErrors.baseShare.notFound';
const baseShareAlreadyExistsKey = 'httpErrors.baseShare.alreadyExists';

@Injectable()
export class BaseShareService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  private async invalidateBaseShareListCache(baseId: string): Promise<void> {
    await this.performanceCacheService.del(generateBaseShareListCacheKey(baseId));
  }

  private formatBaseShareVo(share: {
    baseId: string;
    shareId: string;
    password: string | null;
    nodeId: string;
    allowSave: boolean | null;
    allowCopy: boolean | null;
    enabled: boolean;
  }): IBaseShareVo {
    return {
      baseId: share.baseId,
      shareId: share.shareId,
      password: share.password != null, // Only return if password is set, not the actual value
      nodeId: share.nodeId,
      allowSave: share.allowSave,
      allowCopy: share.allowCopy,
      enabled: share.enabled,
    };
  }

  async createBaseShare(baseId: string, data: ICreateBaseShareRo): Promise<IBaseShareVo> {
    const userId = this.cls.get('user.id');

    // Check if a share already exists for this node
    const existingShare = await this.prismaService.baseShare.findFirst({
      where: { baseId, nodeId: data.nodeId },
    });
    if (existingShare) {
      // If existing share is disabled, re-enable it
      if (!existingShare.enabled) {
        const updated = await this.prismaService.baseShare.update({
          where: { id: existingShare.id },
          data: {
            enabled: true,
            password: data.password || existingShare.password,
            allowSave: data.allowSave ?? existingShare.allowSave,
            allowCopy: data.allowCopy ?? existingShare.allowCopy,
          },
        });
        // Invalidate cache when re-enabling share
        await this.invalidateBaseShareListCache(baseId);
        return this.formatBaseShareVo(updated);
      }
      throw new CustomHttpException(
        'A share already exists for this node',
        HttpErrorCode.CONFLICT,
        {
          localization: {
            i18nKey: baseShareAlreadyExistsKey,
          },
        }
      );
    }

    const shareId = generateShareId();
    const share = await this.prismaService.baseShare.create({
      data: {
        baseId,
        shareId,
        password: data.password || null,
        nodeId: data.nodeId,
        allowSave: data.allowSave,
        allowCopy: data.allowCopy,
        createdBy: userId,
      },
    });

    // Invalidate cache when creating new share
    await this.invalidateBaseShareListCache(baseId);

    return this.formatBaseShareVo(share);
  }

  @PerformanceCache({
    ttl: 24 * 60 * 60, // 24 hours
    keyGenerator: generateBaseShareListCacheKey,
    statsType: 'base-share',
  })
  async getBaseShareList(baseId: string): Promise<{ nodeId: string }[]> {
    return this.prismaService.baseShare.findMany({
      where: {
        baseId,
        enabled: true,
      },
      orderBy: { createdTime: 'desc' },
      select: {
        nodeId: true,
      },
    });
  }

  async getBaseShareByNodeId(baseId: string, nodeId: string): Promise<IBaseShareVo | null> {
    const share = await this.prismaService.baseShare.findFirst({
      where: { baseId, nodeId, enabled: true },
    });

    if (!share) {
      return null;
    }

    return this.formatBaseShareVo(share);
  }

  async updateBaseShare(
    baseId: string,
    shareId: string,
    data: IUpdateBaseShareRo
  ): Promise<IBaseShareVo> {
    const share = await this.prismaService.baseShare.findFirst({
      where: { baseId, shareId, enabled: true },
    });

    if (!share) {
      throw new CustomHttpException(baseShareNotFoundMessage, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: baseShareNotFoundKey,
        },
      });
    }

    const updated = await this.prismaService.baseShare.update({
      where: { id: share.id },
      data: {
        password: data.password !== undefined ? data.password : share.password,
        allowSave: data.allowSave !== undefined ? data.allowSave : share.allowSave,
        allowCopy: data.allowCopy !== undefined ? data.allowCopy : share.allowCopy,
        enabled: data.enabled !== undefined ? data.enabled : share.enabled,
      },
    });

    // Invalidate cache if enabled status changed
    if (data.enabled !== undefined && data.enabled !== share.enabled) {
      await this.invalidateBaseShareListCache(baseId);
    }

    return this.formatBaseShareVo(updated);
  }

  async deleteBaseShare(baseId: string, shareId: string): Promise<void> {
    const share = await this.prismaService.baseShare.findFirst({
      where: { baseId, shareId, enabled: true },
    });

    if (!share) {
      throw new CustomHttpException(baseShareNotFoundMessage, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: baseShareNotFoundKey,
        },
      });
    }

    // Soft delete: set enabled to false instead of deleting the record
    await this.prismaService.baseShare.update({
      where: { id: share.id },
      data: { enabled: false },
    });

    // Invalidate cache when deleting share
    await this.invalidateBaseShareListCache(baseId);
  }

  async refreshBaseShareId(baseId: string, shareId: string): Promise<IBaseShareVo> {
    const share = await this.prismaService.baseShare.findFirst({
      where: { baseId, shareId, enabled: true },
    });

    if (!share) {
      throw new CustomHttpException(baseShareNotFoundMessage, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: baseShareNotFoundKey,
        },
      });
    }

    const newShareId = generateShareId();
    const updated = await this.prismaService.baseShare.update({
      where: { id: share.id },
      data: { shareId: newShareId },
    });

    return this.formatBaseShareVo(updated);
  }

  async getByShareId(shareId: string) {
    const share = await this.prismaService.baseShare.findUnique({
      where: { shareId },
    });

    if (!share || !share.enabled) {
      throw new CustomHttpException(baseShareNotFoundMessage, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: baseShareNotFoundKey,
        },
      });
    }

    return share;
  }
}
