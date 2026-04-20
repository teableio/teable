import { Injectable } from '@nestjs/common';
import type { IAttachmentCellValue, IOtOperation } from '@teable/core';
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

  private getAttachmentCell(op: IOtOperation) {
    const setRecordOp = RecordOpBuilder.editor.setRecord.detect(op);
    if (!setRecordOp) {
      return;
    }
    const newCellValue = setRecordOp.newCellValue;
    if (newCellValue && Array.isArray(newCellValue) && newCellValue?.[0]?.mimetype) {
      return newCellValue as IAttachmentCellValue;
    }
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
      if (!newCellValue || !Array.isArray(newCellValue) || !newCellValue[0]?.mimetype) return acc;

      const newItems = newCellValue as IAttachmentCellValue;
      const oldItems =
        oldCellValue && Array.isArray(oldCellValue) && oldCellValue[0]?.mimetype
          ? (oldCellValue as IAttachmentCellValue)
          : [];
      const oldNameByToken = new Map(oldItems.map((item) => [item.token, item.name]));

      newItems.forEach((item) => {
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

  private async getThumbnailPathTokenMap(tokens: string[]) {
    const thumbnailPathTokenMap: Record<
      string,
      {
        sm?: string;
        lg?: string;
      }
    > = {};
    // once handle 1000 tokens
    const batchSize = 1000;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const attachments = await this.prismaService.attachments.findMany({
        where: { token: { in: batch } },
        select: { token: true, thumbnailPath: true },
      });
      attachments.forEach((attachment) => {
        if (attachment.thumbnailPath) {
          thumbnailPathTokenMap[attachment.token] = JSON.parse(attachment.thumbnailPath);
        }
      });
    }
    return thumbnailPathTokenMap;
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
    const thumbnailPathTokenMap = await this.getThumbnailPathTokenMap(uniqueTokens);
    const cachePreviewUrlTokenMap = await this.getCachePreviewUrlTokenMap(uniqueTokens);
    return {
      thumbnailPathTokenMap,
      cachePreviewUrlTokenMap,
    };
  }

  private async presignedAttachmentUrl(
    item: { name: string; path: string; token: string; mimetype: string },
    context: {
      thumbnailPathTokenMap: Record<string, { sm?: string; lg?: string }>;
      cachePreviewUrlTokenMap: Record<string, string>;
    }
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

  async repairAttachmentOp(
    rawOp: EditOp | CreateOp | DeleteOp,
    context: {
      thumbnailPathTokenMap: Record<string, { sm?: string; lg?: string }>;
      cachePreviewUrlTokenMap: Record<string, string>;
    }
  ) {
    if (!this.isEditOp(rawOp)) {
      return rawOp;
    }
    for (const op of rawOp.op) {
      const setRecordOp = RecordOpBuilder.editor.setRecord.detect(op);
      if (!setRecordOp) continue;

      const newCellValue = setRecordOp.newCellValue;
      const oldCellValue = setRecordOp.oldCellValue;
      if (!newCellValue || !Array.isArray(newCellValue) || !newCellValue[0]?.mimetype) continue;

      const newAttachmentCell = newCellValue as IAttachmentCellValue;
      const oldAttachmentCell =
        oldCellValue && Array.isArray(oldCellValue) && oldCellValue[0]?.mimetype
          ? (oldCellValue as IAttachmentCellValue)
          : [];
      const oldNameByToken = new Map(oldAttachmentCell.map((item) => [item.token, item.name]));

      for (const item of newAttachmentCell) {
        const oldName = oldNameByToken.get(item.token);
        const isRenamed = oldName != null && oldName !== item.name;
        const needsRepair = !item.presignedUrl || isRenamed;

        if (needsRepair) {
          if (isRenamed) {
            await this.cacheService.del(`attachment:preview:${item.token}`);
            delete context.cachePreviewUrlTokenMap[item.token];
          }

          const { presignedUrl, smThumbnailUrl, lgThumbnailUrl } =
            await this.presignedAttachmentUrl(item, context);
          item.presignedUrl = presignedUrl;
          item.smThumbnailUrl = smThumbnailUrl;
          item.lgThumbnailUrl = lgThumbnailUrl;
        }
      }
      op.oi = newAttachmentCell;
    }
    return rawOp;
  }
}
