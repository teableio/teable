import { Injectable } from '@nestjs/common';
import { isImage } from '@teable/core';
import { UploadType } from '@teable/openapi';
import type {
  AttachmentSignRequest,
  AttachmentSignedUrls,
  IAttachmentUrlSignerService,
  Result,
  DomainError,
} from '@teable/v2-core';
import { ok, IAttachmentLookupService } from '@teable/v2-core';
import pLimit from 'p-limit';

import { CacheService } from '../../cache/cache.service';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import StorageAdapter from '../attachments/plugins/adapter';
import { resolveThumbnailMimetype } from '../attachments/utils';

const ATTACHMENT_DECORATION_CONCURRENCY = 4;

/**
 * Nestjs-backend adapter for the v2-core `IAttachmentUrlSignerService` port.
 *
 * Signs preview / thumbnail URLs via `AttachmentsStorageService`, and clears
 * the `attachment:preview:<token>` cache entries when the v2-core decorator
 * detects a rename. All concurrency + backend-specific quirks (image thumbnail
 * fallback, bucket selection, content-disposition) live here so the core
 * decorator stays infrastructure-agnostic.
 */
@Injectable()
export class V2AttachmentUrlSignerService implements IAttachmentUrlSignerService {
  constructor(
    private readonly attachmentsStorageService: AttachmentsStorageService,
    private readonly attachmentLookupService: IAttachmentLookupService,
    private readonly cacheService: CacheService
  ) {}

  async signItems(
    items: ReadonlyArray<AttachmentSignRequest>
  ): Promise<Result<ReadonlyMap<string, AttachmentSignedUrls>, DomainError>> {
    if (items.length === 0) return ok(new Map());

    const tokens = items.map((i) => i.token);
    const thumbnailPathMap = new Map<string, { sm?: string; lg?: string }>();
    const lookupResult = await this.attachmentLookupService.listAttachmentsByTokens(tokens);
    if (lookupResult.isOk()) {
      for (const record of lookupResult.value) {
        if (record.thumbnailPath) {
          thumbnailPathMap.set(record.token, record.thumbnailPath);
        }
      }
    }

    const limit = pLimit(ATTACHMENT_DECORATION_CONCURRENCY);
    const entries = await Promise.all(
      items.map((item) =>
        limit(async () => [item.token, await this.signOne(item, thumbnailPathMap)] as const)
      )
    );
    return ok(new Map(entries));
  }

  async invalidatePreview(tokens: ReadonlyArray<string>): Promise<Result<void, DomainError>> {
    await Promise.all(tokens.map((t) => this.cacheService.del(`attachment:preview:${t}`)));
    return ok(undefined);
  }

  private async signOne(
    item: AttachmentSignRequest,
    thumbnailPathMap: Map<string, { sm?: string; lg?: string }>
  ): Promise<AttachmentSignedUrls> {
    const presignedUrl = await this.attachmentsStorageService.getPreviewUrlByPath(
      StorageAdapter.getBucket(UploadType.Table),
      item.path,
      item.token,
      undefined,
      {
        'Content-Type': item.mimetype,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(
          item.name ?? item.token
        )}`,
      }
    );

    const thumbnailPaths = thumbnailPathMap.get(item.token);
    if (!thumbnailPaths) {
      if (isImage(item.mimetype)) {
        return {
          presignedUrl,
          smThumbnailUrl: presignedUrl,
          lgThumbnailUrl: presignedUrl,
        };
      }
      return { presignedUrl };
    }

    const { sm: smThumbnailPath, lg: lgThumbnailPath } = thumbnailPaths;
    const thumbnailMimetype = resolveThumbnailMimetype(item.mimetype);

    const smThumbnailUrl = smThumbnailPath
      ? await this.attachmentsStorageService.getTableThumbnailUrl(
          smThumbnailPath,
          thumbnailMimetype
        )
      : undefined;
    const lgThumbnailUrl = lgThumbnailPath
      ? await this.attachmentsStorageService.getTableThumbnailUrl(
          lgThumbnailPath,
          thumbnailMimetype
        )
      : undefined;

    const isImg = isImage(item.mimetype);
    return {
      presignedUrl,
      smThumbnailUrl: isImg ? smThumbnailUrl || presignedUrl : smThumbnailUrl,
      lgThumbnailUrl: isImg ? lgThumbnailUrl || presignedUrl : lgThumbnailUrl,
    };
  }
}
