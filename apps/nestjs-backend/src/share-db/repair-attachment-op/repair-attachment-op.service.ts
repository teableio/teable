import { Injectable } from '@nestjs/common';
import type { IAttachmentCellValue } from '@teable/core';
import { isImage, RecordOpBuilder } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import type { EditOp, CreateOp, DeleteOp } from 'sharedb';
import { CacheService } from '../../cache/cache.service';
import { AttachmentsStorageService } from '../../features/attachments/attachments-storage.service';
import StorageAdapter from '../../features/attachments/plugins/adapter';
import { resolveThumbnailMimetype } from '../../features/attachments/utils';
import { getTableThumbnailToken } from '../../utils/generate-thumbnail-path';
import { Timing } from '../../utils/timing';
import type { IRawOpMap } from '../interface';

type IPartialAttachmentItem = Partial<IAttachmentCellValue[number]> & {
  token?: unknown;
  name?: unknown;
  path?: unknown;
  mimetype?: unknown;
  presignedUrl?: unknown;
};

type IAttachmentMeta = {
  token: string;
  path: string;
  size: number;
  mimetype: string;
  width?: number;
  height?: number;
  thumbnailPath?: {
    sm?: string;
    lg?: string;
  };
};

type IRepairAttachmentContext = {
  attachmentMetaTokenMap: Record<string, IAttachmentMeta>;
  thumbnailPathTokenMap: Record<string, { sm?: string; lg?: string }>;
  cachePreviewUrlTokenMap: Record<string, string>;
};

@Injectable()
export class RepairAttachmentOpService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly attachmentsStorageService: AttachmentsStorageService
  ) {}

  private isEditOp(rawOp: EditOp | CreateOp | DeleteOp): rawOp is EditOp {
    return Boolean(!rawOp.del && !rawOp.create && rawOp.op);
  }

  private getAttachmentItems(value: unknown): IPartialAttachmentItem[] | undefined {
    if (!value || !Array.isArray(value) || value.length === 0) return;
    if (!value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) return;
    if (!value.some((item) => typeof (item as IPartialAttachmentItem).token === 'string')) return;
    return value as IPartialAttachmentItem[];
  }

  private getCollectionsAttachmentToken(rawOp: EditOp | CreateOp | DeleteOp): string[] | undefined {
    if (!this.isEditOp(rawOp)) {
      return;
    }
    return rawOp.op.reduce((acc, op) => {
      const setRecordOp = RecordOpBuilder.editor.setRecord.detect(op);
      if (!setRecordOp) return acc;

      const newCellValue = setRecordOp.newCellValue;
      const oldCellValue = setRecordOp.oldCellValue;
      const newItems = this.getAttachmentItems(newCellValue);
      if (!newItems) return acc;

      const oldItems = this.getAttachmentItems(oldCellValue) ?? [];
      const oldNameByToken = new Map(
        oldItems
          .filter((item) => typeof item.token === 'string')
          .map((item) => [item.token as string, item.name])
      );

      newItems.forEach((item) => {
        if (typeof item.token !== 'string') return;
        const oldName = oldNameByToken.get(item.token);
        const isNew = !item.presignedUrl;
        const isRenamed = oldName != null && oldName !== item.name;
        if (isNew || isRenamed) {
          acc.push(item.token);
        }
      });
      return acc;
    }, [] as string[]);
  }

  private parseThumbnailPath(value: unknown) {
    if (!value || typeof value !== 'string') return;
    try {
      return JSON.parse(value) as { sm?: string; lg?: string };
    } catch {
      return;
    }
  }

  private async getAttachmentMetaTokenMap(tokens: string[]) {
    const attachmentMetaTokenMap: Record<string, IAttachmentMeta> = {};
    // once handle 1000 tokens
    const batchSize = 1000;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const attachments = await this.prismaService.attachments.findMany({
        where: { token: { in: batch } },
        select: {
          token: true,
          path: true,
          size: true,
          mimetype: true,
          width: true,
          height: true,
          thumbnailPath: true,
        },
      });
      attachments.forEach((attachment) => {
        attachmentMetaTokenMap[attachment.token] = {
          token: attachment.token,
          path: attachment.path,
          size: Number(attachment.size),
          mimetype: attachment.mimetype,
          width: attachment.width ?? undefined,
          height: attachment.height ?? undefined,
          thumbnailPath: this.parseThumbnailPath(attachment.thumbnailPath),
        };
      });
    }
    return attachmentMetaTokenMap;
  }

  private async getCachePreviewUrlTokenMap(tokens: string[]) {
    const previewUrlTokenMap: Record<string, string> = {};
    // once handle 1000 tokens
    const batchSize = 1000;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const previewUrls = await this.cacheService.getMany(
        batch.map((token) => `attachment:preview:${token}` as const)
      );
      previewUrls.forEach((urlCache, index) => {
        if (urlCache) {
          previewUrlTokenMap[batch[i + index]] = urlCache.url;
        }
      });
    }
    return previewUrlTokenMap;
  }

  @Timing()
  async getCollectionsAttachmentsContext(rawOpMaps: IRawOpMap[]) {
    const collectionsAttachmentTokens: Record<string, string[]> = {};
    for (const rawOpMap of rawOpMaps) {
      for (const collection in rawOpMap) {
        const data = rawOpMap[collection];
        for (const docId in data) {
          const rawOp = data[docId] as EditOp | CreateOp | DeleteOp;
          const attachmentCells = this.getCollectionsAttachmentToken(rawOp);
          const tableId = collection.split('_')[1];
          if (attachmentCells?.length) {
            collectionsAttachmentTokens[`${tableId}-${docId}`] = attachmentCells;
          }
        }
      }
    }
    const tokens = Object.values(collectionsAttachmentTokens).flat();
    const uniqueTokens = [...new Set(tokens)];
    const attachmentMetaTokenMap = await this.getAttachmentMetaTokenMap(uniqueTokens);
    const thumbnailPathTokenMap = Object.fromEntries(
      Object.values(attachmentMetaTokenMap)
        .filter((attachment) => attachment.thumbnailPath)
        .map((attachment) => [attachment.token, attachment.thumbnailPath!])
    );
    const cachePreviewUrlTokenMap = await this.getCachePreviewUrlTokenMap(uniqueTokens);
    return {
      attachmentMetaTokenMap,
      thumbnailPathTokenMap,
      cachePreviewUrlTokenMap,
    };
  }

  private async presignedAttachmentUrl(
    item: { name: string; path: string; token: string; mimetype: string },
    context: IRepairAttachmentContext
  ) {
    const { thumbnailPathTokenMap, cachePreviewUrlTokenMap } = context;
    const { path, token, mimetype, name } = item;

    const presignedUrl =
      cachePreviewUrlTokenMap[token] ??
      (await this.attachmentsStorageService.getPreviewUrlByPath(
        StorageAdapter.getBucket(UploadType.Table),
        path,
        token,
        undefined,
        {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': mimetype,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Disposition': `attachment; filename="${name}"`,
        }
      ));
    let smThumbnailUrl: string | undefined;
    let lgThumbnailUrl: string | undefined;
    const isImg = isImage(mimetype);
    const thumbnailMimetype = resolveThumbnailMimetype(mimetype);
    if (thumbnailPathTokenMap && thumbnailPathTokenMap[token]) {
      const { sm: smThumbnailPath, lg: lgThumbnailPath } = thumbnailPathTokenMap[token]!;
      if (smThumbnailPath) {
        smThumbnailUrl =
          cachePreviewUrlTokenMap?.[getTableThumbnailToken(smThumbnailPath)] ??
          (await this.attachmentsStorageService.getTableThumbnailUrl(
            smThumbnailPath,
            thumbnailMimetype
          ));
      }
      if (lgThumbnailPath) {
        lgThumbnailUrl =
          cachePreviewUrlTokenMap?.[getTableThumbnailToken(lgThumbnailPath)] ??
          (await this.attachmentsStorageService.getTableThumbnailUrl(
            lgThumbnailPath,
            thumbnailMimetype
          ));
      }
    }

    return {
      presignedUrl,
      smThumbnailUrl: isImg ? smThumbnailUrl || presignedUrl : smThumbnailUrl,
      lgThumbnailUrl: isImg ? lgThumbnailUrl || presignedUrl : lgThumbnailUrl,
    };
  }

  private mergeAttachmentMeta(
    item: IPartialAttachmentItem,
    context: IRepairAttachmentContext
  ): IPartialAttachmentItem {
    if (typeof item.token !== 'string') return item;
    const meta = context.attachmentMetaTokenMap[item.token];
    if (!meta) return item;
    return {
      ...item,
      path: typeof item.path === 'string' ? item.path : meta.path,
      size: typeof item.size === 'number' ? item.size : meta.size,
      mimetype: typeof item.mimetype === 'string' ? item.mimetype : meta.mimetype,
      width: typeof item.width === 'number' ? item.width : meta.width,
      height: typeof item.height === 'number' ? item.height : meta.height,
    };
  }

  private isSignableAttachmentItem(
    item: IPartialAttachmentItem
  ): item is IPartialAttachmentItem & { token: string; path: string; mimetype: string } {
    return (
      typeof item.token === 'string' &&
      typeof item.path === 'string' &&
      typeof item.mimetype === 'string'
    );
  }

  private async repairAttachmentItem(
    item: IPartialAttachmentItem,
    oldNameByToken: Map<string, unknown>,
    context: IRepairAttachmentContext
  ) {
    if (!this.isSignableAttachmentItem(item)) return;

    const oldName = oldNameByToken.get(item.token);
    const isRenamed = oldName != null && oldName !== item.name;
    const needsRepair = !item.presignedUrl || isRenamed;
    if (!needsRepair) return;

    if (isRenamed) {
      await this.cacheService.del(`attachment:preview:${item.token}`);
      delete context.cachePreviewUrlTokenMap[item.token];
    }

    const { presignedUrl, smThumbnailUrl, lgThumbnailUrl } = await this.presignedAttachmentUrl(
      {
        name: typeof item.name === 'string' ? item.name : item.token,
        path: item.path,
        token: item.token,
        mimetype: item.mimetype,
      },
      context
    );
    item.presignedUrl = presignedUrl;
    item.smThumbnailUrl = smThumbnailUrl;
    item.lgThumbnailUrl = lgThumbnailUrl;
  }

  async repairAttachmentOp(rawOp: EditOp | CreateOp | DeleteOp, context: IRepairAttachmentContext) {
    if (!this.isEditOp(rawOp)) {
      return rawOp;
    }
    for (const op of rawOp.op) {
      const setRecordOp = RecordOpBuilder.editor.setRecord.detect(op);
      if (!setRecordOp) continue;

      const newCellValue = setRecordOp.newCellValue;
      const oldCellValue = setRecordOp.oldCellValue;
      const newAttachmentCell = this.getAttachmentItems(newCellValue);
      if (!newAttachmentCell) continue;

      const oldAttachmentCell = this.getAttachmentItems(oldCellValue) ?? [];
      const oldNameByToken = new Map(
        oldAttachmentCell
          .filter((item) => typeof item.token === 'string')
          .map((item) => [item.token as string, item.name])
      );

      const repairedAttachmentCell = newAttachmentCell.map((item) =>
        this.mergeAttachmentMeta(item, context)
      );

      for (const item of repairedAttachmentCell) {
        await this.repairAttachmentItem(item, oldNameByToken, context);
      }
      op.oi = repairedAttachmentCell;
    }
    return rawOp;
  }
}
