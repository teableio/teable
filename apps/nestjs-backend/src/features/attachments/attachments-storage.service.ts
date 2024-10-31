import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import { CacheService } from '../../cache/cache.service';
import { IStorageConfig, StorageConfig } from '../../configs/storage';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import {
  generateTableThumbnailPath,
  getTableThumbnailToken,
} from '../../utils/generate-thumbnail-path';
import { second } from '../../utils/second';
import { ATTACHMENT_LG_THUMBNAIL_HEIGHT, ATTACHMENT_SM_THUMBNAIL_HEIGHT } from './constant';
import StorageAdapter from './plugins/adapter';
import { InjectStorageAdapter } from './plugins/storage';
import type { IRespHeaders } from './plugins/types';

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
      throw new BadRequestException(`Invalid token: ${token}`);
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
    const previewCache = await this.cacheService.get(`attachment:preview:${token}`);
    let url = previewCache?.url;
    if (!url) {
      url = await this.storageAdapter.getPreviewUrl(bucket, path, expiresIn, respHeaders);
      await this.cacheService.set(
        `attachment:preview:${token}`,
        {
          url,
          expiresIn,
        },
        expiresIn
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
