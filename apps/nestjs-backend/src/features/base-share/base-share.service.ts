import { Injectable } from '@nestjs/common';
import { generateShareId, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateBaseShareRo, IUpdateBaseShareRo, IBaseShareVo } from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateBaseShareListCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';

const baseShareNotFoundMessage = 'Base share not found';
const baseShareNotFoundKey = 'httpErrors.baseShare.notFound';
const baseShareAlreadyExistsKey = 'httpErrors.baseShare.alreadyExists';
const allowEditNotSupportedMessage = 'allowEdit is only supported for table or folder nodes';

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

  private async isEditableNode(nodeId: string): Promise<boolean> {
    const node = await this.prismaService.baseNode.findFirst({
      where: { id: nodeId },
      select: { resourceType: true },
    });
    return (
      node?.resourceType === BaseNodeResourceType.Table ||
      node?.resourceType === BaseNodeResourceType.Folder
    );
  }

  /**
   * allowEdit and allowSave are mutually exclusive:
   * allowEdit=true → allowSave must be false
   * allowSave=true → allowEdit must be false
   */
  private resolveEditSaveFlags(
    allowEdit: boolean | null | undefined,
    allowSave: boolean | null | undefined
  ): { allowEdit: boolean | null; allowSave: boolean | null } {
    const edit = allowEdit ?? null;
    const save = allowSave ?? null;
    if (edit) return { allowEdit: true, allowSave: false };
    if (save) return { allowEdit: false, allowSave: true };
    return { allowEdit: edit, allowSave: save };
  }

  private formatBaseShareVo(share: {
    baseId: string;
    shareId: string;
    password: string | null;
    nodeId: string | null;
    allowSave: boolean | null;
    allowCopy: boolean | null;
    allowEdit: boolean | null;
    enabled: boolean;
  }): IBaseShareVo {
    return {
      baseId: share.baseId,
      shareId: share.shareId,
      password: share.password != null, // Only return if password is set, not the actual value
      nodeId: share.nodeId,
      allowSave: share.allowSave,
      allowCopy: share.allowCopy,
      allowEdit: share.allowEdit,
      enabled: share.enabled,
    };
  }

  async createBaseShare(baseId: string, data: ICreateBaseShareRo): Promise<IBaseShareVo> {
    const nodeId = data.nodeId ?? null;

    const existingShare = await this.prismaService.baseShare.findFirst({
      where: { baseId, nodeId },
    });

    if (existingShare) {
      if (!existingShare.enabled) {
        // Hard-delete the old disabled share so a fresh one can be created
        await this.prismaService.baseShare.delete({ where: { id: existingShare.id } });
      } else {
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
    }

    const share = await this.prismaService.baseShare.create({
      data: {
        baseId,
        shareId: generateShareId(),
        nodeId,
        createdBy: this.cls.get('user.id'),
      },
    });

    await this.invalidateBaseShareListCache(baseId);
    return this.formatBaseShareVo(share);
  }

  @PerformanceCache({
    ttl: 24 * 60 * 60, // 24 hours
    keyGenerator: generateBaseShareListCacheKey,
    statsType: 'base-share',
  })
  async getBaseShareList(baseId: string): Promise<{ nodeId: string | null }[]> {
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

  async getBaseShare(baseId: string): Promise<IBaseShareVo | null> {
    const share = await this.prismaService.baseShare.findFirst({
      where: { baseId, nodeId: null, enabled: true },
    });

    if (!share) {
      return null;
    }

    return this.formatBaseShareVo(share);
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

    if (data.allowEdit && share.nodeId && !(await this.isEditableNode(share.nodeId))) {
      throw new CustomHttpException(allowEditNotSupportedMessage, HttpErrorCode.VALIDATION_ERROR);
    }

    const { allowEdit, allowSave } = this.resolveEditSaveFlags(
      data.allowEdit !== undefined ? data.allowEdit : share.allowEdit,
      data.allowSave !== undefined ? data.allowSave : share.allowSave
    );

    const updated = await this.prismaService.baseShare.update({
      where: { id: share.id },
      data: {
        password: data.password !== undefined ? data.password : share.password,
        allowSave,
        allowCopy: data.allowCopy !== undefined ? data.allowCopy : share.allowCopy,
        allowEdit,
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
