import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import { CacheService } from '../../cache/cache.service';
import { IStorageConfig, StorageConfig } from '../../configs/storage';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import {
  generateTableThumbnailPath,
  getTableThumbnailSize,
  getTableThumbnailToken,
} from '../../utils/generate-table-thumbnail-path';
import { second } from '../../utils/second';
import StorageAdapter from './plugins/adapter';
import { InjectStorageAdapter } from './plugins/storage';
import type { IRespHeaders } from './plugins/types';

@Injectable()
export class AttachmentsStorageService {
  constructor(
    private readonly cacheService: CacheService,
    private readonly prismaService: PrismaService,
    private readonly eventEmitterService: EventEmitterService,
    @StorageConfig() private readonly storageConfig: IStorageConfig,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter
  ) {}

  async getPreviewUrl<T extends string | string[] = string | string[]>(
    bucket: string,
    token: T,
    meta?: { expiresIn?: number }
  ): Promise<T> {
    const { expiresIn = second(this.storageConfig.urlExpireIn) } = meta ?? {};
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
    expiresIn: number = second(this.storageConfig.urlExpireIn),
    respHeaders?: IRespHeaders
  ) {
    const previewCache = await this.cacheService.get(`attachment:preview:${token}`);
    let url = previewCache?.url;
    if (!url) {
      url = await this.storageAdapter.getPreviewUrl(bucket, path, expiresIn, respHeaders);
      if (!url) {
        throw new BadRequestException(`Invalid token: ${token}`);
      }
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

  private async getTableThumbnailUrl(path: string, token: string) {
    const previewCache = await this.cacheService.get(`attachment:preview:${token}`);
    if (previewCache?.url) {
      return previewCache.url;
    }
    const url = await this.storageAdapter.getPreviewUrl(
      StorageAdapter.getBucket(UploadType.Table),
      path,
      second(this.storageConfig.urlExpireIn)
    );
    if (url) {
      await this.cacheService.set(
        `attachment:preview:${token}`,
        {
          url,
          expiresIn: second(this.storageConfig.urlExpireIn),
        },
        second(this.storageConfig.urlExpireIn)
      );
    }
    return url;
  }

  async getTableAttachmentThumbnailUrl(path: string) {
    const { smThumbnailPath, lgThumbnailPath } = generateTableThumbnailPath(path);
    const smThumbnailUrl = await this.getTableThumbnailUrl(
      smThumbnailPath,
      getTableThumbnailToken(smThumbnailPath)
    );
    const lgThumbnailUrl = await this.getTableThumbnailUrl(
      lgThumbnailPath,
      getTableThumbnailToken(lgThumbnailPath)
    );
    return { smThumbnailUrl, lgThumbnailUrl };
  }

  async cutTableImage(bucket: string, path: string, width: number, height: number) {
    const { smThumbnail, lgThumbnail } = getTableThumbnailSize(width, height);
    const { smThumbnailPath, lgThumbnailPath } = generateTableThumbnailPath(path);
    const cutSmThumbnailPath = await this.storageAdapter.cropImage(
      bucket,
      path,
      smThumbnail.width,
      smThumbnail.height,
      smThumbnailPath
    );
    const cutLgThumbnailPath = await this.storageAdapter.cropImage(
      bucket,
      path,
      lgThumbnail.width,
      lgThumbnail.height,
      lgThumbnailPath
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
}
