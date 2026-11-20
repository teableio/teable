import { Injectable } from '@nestjs/common';
import type { IAttachmentCellValue } from '@teable/core';
import { isImage } from '@teable/core';
import { UploadType } from '@teable/openapi';
import { getTableThumbnailToken } from '../../utils/generate-thumbnail-path';
import { AttachmentsStorageService } from './attachments-storage.service';
import StorageAdapter from './plugins/adapter';
import { resolveThumbnailMimetype } from './utils';

type IAttachmentCellValueLike = IAttachmentCellValue | IAttachmentCellValue[number];

@Injectable()
export class AttachmentCellValueService {
  constructor(private readonly attachmentStorageService: AttachmentsStorageService) {}

  normalizeAttachmentCellValue(cellValue: unknown): IAttachmentCellValue | null {
    if (cellValue == null) {
      return null;
    }

    return Array.isArray(cellValue) ? cellValue : [cellValue as IAttachmentCellValue[number]];
  }

  async getAttachmentPresignedCellValue(
    cellValue: IAttachmentCellValueLike | null,
    cacheTokenUrlMap?: Record<string, string>,
    thumbnailPathTokenMap?: Record<string, { sm?: string; lg?: string } | undefined>
  ) {
    const normalizedCellValue = this.normalizeAttachmentCellValue(cellValue);
    if (normalizedCellValue == null) {
      return null;
    }
    return await Promise.all(
      normalizedCellValue.map(async (item) => {
        const { path, mimetype, token } = item;
        const presignedUrl =
          cacheTokenUrlMap?.[token] ??
          (await this.attachmentStorageService.getPreviewUrlByPath(
            StorageAdapter.getBucket(UploadType.Table),
            path,
            token,
            undefined,
            {
              'Content-Type': mimetype,
              'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
            }
          ));
        let smThumbnailUrl: string | undefined;
        let lgThumbnailUrl: string | undefined;
        const isImg = isImage(mimetype);
        if (thumbnailPathTokenMap?.[token]) {
          const { sm: smThumbnailPath, lg: lgThumbnailPath } = thumbnailPathTokenMap[token]!;
          if (smThumbnailPath) {
            smThumbnailUrl =
              cacheTokenUrlMap?.[getTableThumbnailToken(smThumbnailPath)] ??
              (await this.attachmentStorageService.getTableThumbnailUrl(
                smThumbnailPath,
                resolveThumbnailMimetype(mimetype, smThumbnailPath)
              ));
          }
          if (lgThumbnailPath) {
            lgThumbnailUrl =
              cacheTokenUrlMap?.[getTableThumbnailToken(lgThumbnailPath)] ??
              (await this.attachmentStorageService.getTableThumbnailUrl(
                lgThumbnailPath,
                resolveThumbnailMimetype(mimetype, lgThumbnailPath)
              ));
          }
        }

        return {
          ...item,
          presignedUrl,
          smThumbnailUrl: isImg ? smThumbnailUrl || presignedUrl : smThumbnailUrl,
          lgThumbnailUrl: isImg ? lgThumbnailUrl || presignedUrl : lgThumbnailUrl,
        };
      })
    );
  }
}
