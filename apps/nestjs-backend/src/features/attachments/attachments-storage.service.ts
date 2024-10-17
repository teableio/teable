import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import { CacheService } from '../../cache/cache.service';
import { IStorageConfig, StorageConfig } from '../../configs/storage';
import {
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

  async getTableAttachmentThumbnailUrl(smThumbnailPath?: string, lgThumbnailPath?: string) {
    const smThumbnailUrl = smThumbnailPath
      ? await this.getPreviewUrlByPath(
          StorageAdapter.getBucket(UploadType.Table),
          smThumbnailPath,
          getTableThumbnailToken(smThumbnailPath)
        )
      : undefined;
    const lgThumbnailUrl = lgThumbnailPath
      ? await this.getPreviewUrlByPath(
          StorageAdapter.getBucket(UploadType.Table),
          lgThumbnailPath,
          getTableThumbnailToken(lgThumbnailPath)
        )
      : undefined;
    return { smThumbnailUrl, lgThumbnailUrl };
  }

  async cutTableImage(bucket: string, path: string, width: number, height: number) {
    const { smThumbnail, lgThumbnail } = getTableThumbnailSize(width, height);
    const cutSmThumbnailPath = await this.storageAdapter.cutImage(
      bucket,
      path,
      smThumbnail.width,
      smThumbnail.height
    );
    const cutLgThumbnailPath = await this.storageAdapter.cutImage(
      bucket,
      path,
      lgThumbnail.width,
      lgThumbnail.height
    );
    return {
      smThumbnailPath: cutSmThumbnailPath,
      lgThumbnailPath: cutLgThumbnailPath,
    };
  }
}
