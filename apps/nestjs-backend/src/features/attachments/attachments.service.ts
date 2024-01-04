import { join } from 'path';
import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { SignatureRo, SignatureVo } from '@teable-group/openapi';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import { StorageConfig, IStorageConfig } from '../../configs/storage';
import type { IClsStore } from '../../types/cls';
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
    const hash = await localStorage.getHash(file.path);
    await localStorage.save(file, join(bucket, path));

    await this.cacheService.set(
      `attachment:upload:${token}`,
      { mimetype: file.mimetype, hash, size: file.size },
      60 * 60 * 24 * 7
    );
  }

  async readLocalFile(token: string, filename?: string) {
    const localStorage = this.storageAdapter as LocalStorage;
    const { path, respHeaders } = localStorage.verifyReadToken(token);
    if (!path) {
      throw new HttpException(`Could not find attachment: ${token}`, HttpStatus.NOT_FOUND);
    }
    const headers: Record<string, string> = respHeaders ?? {};
    if (filename) {
      headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }

    const fileStream = localStorage.read(path);
    return { headers, fileStream };
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
      signatureRo.expiresIn ?? this.storageConfig.tokenExpireIn
    );
    return res;
  }

  async notify(token: string) {
    const tokenCache = await this.cacheService.get(`attachment:signature:${token}`);
    if (!tokenCache) {
      throw new BadRequestException(`Invalid token: ${token}`);
    }
    const userId = this.cls.get('user.id');
    const { path, bucket } = tokenCache;
    const { hash, size, mimetype, width, height, url } = await this.storageAdapter.getObject(
      bucket,
      path,
      token
    );
    const attachment = await this.prismaService.txClient().attachments.create({
      data: {
        bucket,
        hash,
        size,
        mimetype,
        token,
        path,
        width,
        height,
        createdBy: userId,
        lastModifiedBy: userId,
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
    return {
      ...attachment,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
      bucket,
      url,
      presignedUrl: await this.attachmentsStorageService.getPreviewUrlByPath(
        bucket,
        path,
        token,
        undefined,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        { 'Content-Type': mimetype }
      ),
    };
  }
}
