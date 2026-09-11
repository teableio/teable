import { Injectable, Logger } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import sharp from 'sharp';
import { CacheService } from '../../cache/cache.service';
import { IStorageConfig, StorageConfig } from '../../configs/storage';
import { CustomHttpException } from '../../custom.exception';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import {
  generateTableThumbnailPath,
  getTableThumbnailToken,
} from '../../utils/generate-thumbnail-path';
import { second } from '../../utils/second';
import {
  ATTACHMENT_LG_THUMBNAIL_HEIGHT,
  ATTACHMENT_SM_THUMBNAIL_HEIGHT,
  ATTACHMENT_THUMBNAIL_DEFAULT_MIMETYPE,
} from './constant';
import StorageAdapter from './plugins/adapter';
import { InjectStorageAdapter } from './plugins/storage';
import type { IRespHeaders } from './plugins/types';
import {
  getFreshPreviewCacheUrl,
  getPreviewCacheKey,
  getPreviewUrlConfigSig,
} from './plugins/utils';

@Injectable()
export class AttachmentsStorageService {
  private readonly urlExpireIn: number;
  private readonly logger = new Logger(AttachmentsStorageService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly prismaService: PrismaService,
    private readonly eventEmitterService: EventEmitterService,
    @StorageConfig() private readonly storageConfig: IStorageConfig,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter
  ) {
    this.urlExpireIn = second(this.storageConfig.urlExpireIn);
  }

  async getPreviewUrl<T extends string | string[] = string | string[]>(
    bucket: string,
    token: T,
    meta?: { expiresIn?: number }
  ): Promise<T> {
    const { expiresIn = this.urlExpireIn } = meta ?? {};
    const isArray = Array.isArray(token);
    if (isArray && token.length === 0) {
      return [] as unknown as T;
    }
    if (!isArray && !token) {
      return '' as T;
    }
    const attachment = await this.prismaService.txClient().attachments.findMany({
      where: {
        token: isArray ? { in: token } : token,
        deletedTime: null,
      },
      select: {
        path: true,
        token: true,
        mimetype: true,
      },
    });
    if (!attachment) {
      throw new CustomHttpException('Invalid token', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.attachment.invalidToken',
        },
      });
    }
    const urlArray: string[] = [];
    for (const item of attachment) {
      const { path, token, mimetype } = item;
      const url = await this.getPreviewUrlByPath(bucket, path, token, expiresIn, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': mimetype,
      });
      urlArray.push(url);
    }
    return (isArray ? urlArray : urlArray[0]) as T;
  }

  async getPreviewUrlByPath(
    bucket: string,
    path: string,
    token: string,
    expiresIn: number = this.urlExpireIn,
    respHeaders?: IRespHeaders
  ) {
    // Use 50% of URL expiration time for cache TTL to ensure URLs are refreshed
    // before they expire, preventing stale URLs after deployments
    const cacheTtl = Math.floor(expiresIn * 0.5);
    const cacheKey = getPreviewCacheKey(token);
    const previewCache = await this.cacheService.get(cacheKey);
    let url = getFreshPreviewCacheUrl(previewCache);
    if (!url) {
      url = await this.storageAdapter.getPreviewUrl(bucket, path, expiresIn, respHeaders);
      await this.cacheService.set(
        cacheKey,
        {
          url,
          expiresIn,
          configSig: getPreviewUrlConfigSig(),
        },
        cacheTtl
      );
    }
    return url;
  }

  async getTableThumbnailUrl(path: string, mimetype: string) {
    return this.getPreviewUrlByPath(
      StorageAdapter.getBucket(UploadType.Table),
      path,
      getTableThumbnailToken(path),
      undefined,
      {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': mimetype,
      }
    );
  }

  /**
   * Thumbnails for files the browser cannot render itself (HEIC, PDF), rendered
   * from a decoded raster. Unlike `cropTableImage` both sizes are always
   * written: readers treat a missing thumbnail as "use the original", which
   * only works for renderable images. Small rasters are stored at their own
   * size rather than upscaled.
   */
  async uploadTableImageThumbnailsFromBuffer(bucket: string, path: string, imageBuffer: Buffer) {
    const mimetype = ATTACHMENT_THUMBNAIL_DEFAULT_MIMETYPE;
    const { smThumbnailPath, lgThumbnailPath } = generateTableThumbnailPath(path);
    const image = sharp(imageBuffer, { failOn: 'none', unlimited: true });

    const uploadThumbnail = async (thumbnailPath: string, height: number) => {
      const buffer = await image
        .clone()
        .resize(undefined, height, { withoutEnlargement: true })
        .png()
        .toBuffer();
      return (
        await this.storageAdapter.uploadFile(bucket, thumbnailPath, buffer, {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': mimetype,
        })
      ).path;
    };

    const cutSmThumbnailPath = await uploadThumbnail(
      smThumbnailPath,
      ATTACHMENT_SM_THUMBNAIL_HEIGHT
    );
    const cutLgThumbnailPath = await uploadThumbnail(
      lgThumbnailPath,
      ATTACHMENT_LG_THUMBNAIL_HEIGHT
    );

    this.eventEmitterService.emit(Events.CROP_IMAGE, {
      bucket,
      path,
    });

    return {
      smThumbnailPath: cutSmThumbnailPath,
      lgThumbnailPath: cutLgThumbnailPath,
    };
  }

  async cropTableImage(bucket: string, path: string, height: number) {
    const { smThumbnailPath, lgThumbnailPath } = generateTableThumbnailPath(path);
    const cutSmThumbnailPath =
      height > ATTACHMENT_SM_THUMBNAIL_HEIGHT
        ? await this.storageAdapter.cropImage(
            bucket,
            path,
            undefined,
            ATTACHMENT_SM_THUMBNAIL_HEIGHT,
            smThumbnailPath
          )
        : undefined;
    const cutLgThumbnailPath =
      height > ATTACHMENT_LG_THUMBNAIL_HEIGHT
        ? await this.storageAdapter.cropImage(
            bucket,
            path,
            undefined,
            ATTACHMENT_LG_THUMBNAIL_HEIGHT,
            lgThumbnailPath
          )
        : undefined;
    this.eventEmitterService.emit(Events.CROP_IMAGE, {
      bucket,
      path,
    });
    return {
      smThumbnailPath: cutSmThumbnailPath,
      lgThumbnailPath: cutLgThumbnailPath,
    };
  }
}
