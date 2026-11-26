import { Injectable, Logger } from '@nestjs/common';
import { isImage } from '@teable/core';
import { UploadType } from '@teable/openapi';
import type {
  AttachmentPublicLinkRequest,
  AttachmentPublicLinks,
  AttachmentSignRequest,
  AttachmentSignedUrls,
  AttachmentStoredFile,
  IAttachmentUrlSignerService,
  Result,
  DomainError,
} from '@teable/v2-core';
import { ok, IAttachmentLookupService } from '@teable/v2-core';
import pLimit from 'p-limit';

import { CacheService } from '../../cache/cache.service';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import { isBackendOnlyObjectKey, servableThumbnailPaths } from '../attachments/backend-only';
import StorageAdapter from '../attachments/plugins/adapter';
import { getPreviewCacheKey } from '../attachments/plugins/utils';
import { resolveThumbnailMimetype } from '../attachments/utils';
import type { IAttachmentPublicLinkHook } from './attachment-public-link.hook';

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
  private readonly logger = new Logger(V2AttachmentUrlSignerService.name);

  constructor(
    private readonly attachmentsStorageService: AttachmentsStorageService,
    private readonly attachmentLookupService: IAttachmentLookupService,
    private readonly cacheService: CacheService,
    /** Called on each use: registrars add the hook after the signer is built. */
    private readonly resolvePublicLinkHook: () => IAttachmentPublicLinkHook | undefined = () =>
      undefined
  ) {}

  async signItems(
    items: ReadonlyArray<AttachmentSignRequest>
  ): Promise<Result<ReadonlyMap<string, AttachmentSignedUrls>, DomainError>> {
    if (items.length === 0) return ok(new Map());

    const tokens = items.map((i) => i.token);
    const thumbnailPathMap = new Map<string, { sm?: string; lg?: string }>();
    // the live rows, for the public links of the same items; unset when the lookup failed
    let files: Map<string, AttachmentStoredFile> | undefined;
    const lookupResult = await this.attachmentLookupService.listAttachmentsByTokens(tokens);
    if (lookupResult.isOk()) {
      files = new Map();
      for (const record of lookupResult.value) {
        if (record.thumbnailPath) {
          thumbnailPathMap.set(record.token, record.thumbnailPath);
        }
        if (!record.deleted) {
          const { size, mimetype, thumbnailPath } = record;
          files.set(record.token, { size, mimetype, ...(thumbnailPath && { thumbnailPath }) });
        }
      }
    }

    const limit = pLimit(ATTACHMENT_DECORATION_CONCURRENCY);
    const entries = await Promise.all(
      items.map((item) =>
        limit(async () => {
          const urls = await this.signOne(item, thumbnailPathMap);
          return [
            item.token,
            files ? { ...urls, file: files.get(item.token) ?? null } : urls,
          ] as const;
        })
      )
    );
    return ok(new Map(entries));
  }

  async publicLinks(
    cells: ReadonlyArray<AttachmentPublicLinkRequest>
  ): Promise<Result<ReadonlyArray<AttachmentPublicLinks | undefined>, DomainError>> {
    const hook = this.resolvePublicLinkHook();
    if (!hook || cells.length === 0) return ok(cells.map(() => undefined));
    try {
      return ok(await hook.publicLinks(cells));
    } catch (error) {
      // the links are extra: a failed lookup leaves them out rather than failing a read or a write
      this.logger.warn(
        `Public links left out: ${error instanceof Error ? error.message : String(error)}`
      );
      return ok(cells.map(() => undefined));
    }
  }

  async invalidatePreview(tokens: ReadonlyArray<string>): Promise<Result<void, DomainError>> {
    await Promise.all(tokens.map((t) => this.cacheService.del(getPreviewCacheKey(t))));
    return ok(undefined);
  }

  private async signOne(
    item: AttachmentSignRequest,
    thumbnailPathMap: Map<string, { sm?: string; lg?: string }>
  ): Promise<AttachmentSignedUrls> {
    // A cell that names a backend-only object gets no url. The record around it still reads.
    if (isBackendOnlyObjectKey(item.path)) {
      return {};
    }
    const presignedUrl = await this.attachmentsStorageService.getPreviewUrlByPath(
      StorageAdapter.getBucket(UploadType.Table),
      item.path,
      item.token,
      undefined,
      {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': item.mimetype,
        // eslint-disable-next-line @typescript-eslint/naming-convention
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

    const { sm: smThumbnailPath, lg: lgThumbnailPath } = servableThumbnailPaths(thumbnailPaths);

    const smThumbnailUrl = smThumbnailPath
      ? await this.attachmentsStorageService.getTableThumbnailUrl(
          smThumbnailPath,
          resolveThumbnailMimetype(item.mimetype, smThumbnailPath)
        )
      : undefined;
    const lgThumbnailUrl = lgThumbnailPath
      ? await this.attachmentsStorageService.getTableThumbnailUrl(
          lgThumbnailPath,
          resolveThumbnailMimetype(item.mimetype, lgThumbnailPath)
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
