import type { IncomingHttpHeaders } from 'http';
import { join } from 'path';
import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { INotifyVo, SignatureRo, SignatureVo } from '@teable/openapi';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import { StorageConfig, IStorageConfig } from '../../configs/storage';
import type { IClsStore } from '../../types/cls';
import { FileUtils } from '../../utils';
import { second } from '../../utils/second';
import { AttachmentsStorageService } from './attachments-storage.service';
import StorageAdapter from './plugins/adapter';
import type { LocalStorage } from './plugins/local';
import { InjectStorageAdapter } from './plugins/storage';

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly cacheService: CacheService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    @StorageConfig() readonly storageConfig: IStorageConfig,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter
  ) {}
  /**
   * Local upload
   */
  async upload(req: Request, token: string) {
    const tokenCache = await this.cacheService.get(`attachment:signature:${token}`);
    const localStorage = this.storageAdapter as LocalStorage;
    if (!tokenCache) {
      throw new BadRequestException(`Invalid token: ${token}`);
    }
    const { path, bucket } = tokenCache;
    const file = await localStorage.saveTemporaryFile(req);
    await localStorage.validateToken(token, file);
    const hash = await FileUtils.getHash(file.path);
    await localStorage.save(file.path, join(bucket, path));

    await this.cacheService.set(
      `attachment:upload:${token}`,
      { mimetype: file.mimetype, hash, size: file.size },
      second(this.storageConfig.tokenExpireIn)
    );
  }

  async readLocalFile(path: string, token?: string) {
    const localStorage = this.storageAdapter as LocalStorage;
    let respHeaders: Record<string, string> = {};

    if (!path) {
      throw new HttpException(`Could not find attachment: ${token}`, HttpStatus.NOT_FOUND);
    }
    const { bucket, token: tokenInPath } = localStorage.parsePath(path);
    if (token && !StorageAdapter.isPublicBucket(bucket)) {
      respHeaders = localStorage.verifyReadToken(token).respHeaders ?? {};
    } else {
      const attachment = await this.prismaService
        .txClient()
        .attachments.findUnique({ where: { token: tokenInPath, deletedTime: null } });
      if (!attachment) {
        throw new BadRequestException(`Invalid path: ${path}`);
      }
      respHeaders['Content-Type'] = attachment.mimetype;
    }

    const headers: Record<string, string> = respHeaders ?? {};
    const fileStream = localStorage.read(path);

    return { headers, fileStream };
  }

  localFileConditionalCaching(path: string, reqHeaders: IncomingHttpHeaders, res: Response) {
    const ifModifiedSince = reqHeaders['if-modified-since'];
    const localStorage = this.storageAdapter as LocalStorage;
    const lastModifiedTimestamp = localStorage.getLastModifiedTime(path);
    if (!lastModifiedTimestamp) {
      throw new BadRequestException(`Could not find attachment: ${path}`);
    }
    // Comparison of accuracy in seconds
    if (
      !ifModifiedSince ||
      Math.floor(new Date(ifModifiedSince).getTime() / 1000) <
        Math.floor(lastModifiedTimestamp / 1000)
    ) {
      res.set('Last-Modified', new Date(lastModifiedTimestamp).toUTCString());
      return false;
    }
    return true;
  }

  async signature(signatureRo: SignatureRo): Promise<SignatureVo> {
    const { type, ...presignedParams } = signatureRo;
    const hash = presignedParams.hash;
    const dir = StorageAdapter.getDir(type);
    const bucket = StorageAdapter.getBucket(type);
    const res = await this.storageAdapter.presigned(bucket, dir, presignedParams);
    const { path, token } = res;
    await this.cacheService.set(
      `attachment:signature:${token}`,
      { path, bucket, hash },
      signatureRo.expiresIn ?? second(this.storageConfig.tokenExpireIn)
    );
    return res;
  }

  async notify(token: string, filename?: string): Promise<INotifyVo> {
    const tokenCache = await this.cacheService.get(`attachment:signature:${token}`);
    if (!tokenCache) {
      throw new BadRequestException(`Invalid token: ${token}`);
    }
    const userId = this.cls.get('user.id');
    const { path, bucket } = tokenCache;
    const { hash, size, mimetype, width, height, url } = await this.storageAdapter.getObjectMeta(
      bucket,
      path,
      token
    );
    const attachment = await this.prismaService.txClient().attachments.create({
      data: {
        hash,
        size,
        mimetype,
        token,
        path,
        width,
        height,
        createdBy: userId,
      },
      select: {
        token: true,
        size: true,
        mimetype: true,
        width: true,
        height: true,
        path: true,
      },
    });
    const filenameHeader = filename
      ? {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Disposition': `attachment; filename="${filename}"`,
        }
      : {};
    return {
      ...attachment,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
      url,
      presignedUrl: await this.attachmentsStorageService.getPreviewUrlByPath(
        bucket,
        path,
        token,
        undefined,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        { 'Content-Type': mimetype, ...filenameHeader }
      ),
    };
  }
}
