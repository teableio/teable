/* eslint-disable @typescript-eslint/naming-convention */
import { createReadStream, createWriteStream, unlinkSync, existsSync } from 'fs';
import { type Readable as ReadableStream } from 'node:stream';
import { join, resolve } from 'path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import type { Request } from 'express';
import * as fse from 'fs-extra';
import sharp from 'sharp';
import { CacheService } from '../../../cache/cache.service';
import { BaseConfig, IBaseConfig } from '../../../configs/base.config';
import { IStorageConfig, StorageConfig } from '../../../configs/storage';
import { FileUtils } from '../../../utils';
import { Encryptor } from '../../../utils/encryptor';
import { second } from '../../../utils/second';
import StorageAdapter from './adapter';
import type { ILocalFileUpload, IObjectMeta, IPresignParams, IRespHeaders } from './types';

interface ITokenEncryptor {
  expiresDate: number;
  respHeaders?: IRespHeaders;
}

@Injectable()
export class LocalStorage implements StorageAdapter {
  private logger = new Logger(LocalStorage.name);
  path: string;
  storageDir: string;
  expireTokenEncryptor: Encryptor<ITokenEncryptor>;
  static readPath = '/api/attachments/read';

  constructor(
    @StorageConfig() readonly config: IStorageConfig,
    @BaseConfig() readonly baseConfig: IBaseConfig,
    private readonly cacheService: CacheService
  ) {
    this.expireTokenEncryptor = new Encryptor(this.config.encryption);
    this.path = this.config.local.path;
    this.storageDir = resolve(process.cwd(), this.path);
    fse.ensureDirSync(StorageAdapter.TEMPORARY_DIR);
    fse.ensureDirSync(this.storageDir);
  }

  private getUploadUrl(token: string) {
    return `${this.baseConfig.storagePrefix}/api/attachments/upload/${token}`;
  }

  private deleteFile(filePath: string) {
    try {
      unlinkSync(filePath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  private getUrl(bucket: string, path: string, params: ITokenEncryptor) {
    const token = this.expireTokenEncryptor.encrypt(params);
    const responseContentDisposition = params.respHeaders?.['Content-Disposition'];
    return `${join(LocalStorage.readPath, bucket, path)}?token=${token}${responseContentDisposition ? `&response-content-disposition=${responseContentDisposition}` : ''}`;
  }

  parsePath(path: string) {
    const parts = path.split('/');
    return {
      bucket: parts[0],
      token: parts[parts.length - 1],
    };
  }

  async presigned(_bucket: string, dir: string, params: IPresignParams) {
    const { contentType, contentLength, hash } = params;
    const token = getRandomString(12);
    const filename = hash ?? token;
    const expiresIn = params?.expiresIn ?? second(this.config.tokenExpireIn);
    await this.cacheService.set(
      `attachment:local-signature:${token}`,
      {
        expiresDate: Math.floor(Date.now() / 1000) + expiresIn,
        contentLength,
        contentType,
      },
      expiresIn
    );

    const path = join(dir, filename);
    return {
      token,
      path,
      url: this.getUploadUrl(token),
      uploadMethod: 'PUT',
      requestHeaders: {
        'Content-Type': contentType,
        'Content-Length': contentLength,
      },
    };
  }

  async validateToken(token: string, file: ILocalFileUpload) {
    const validateMeta = await this.cacheService.get(`attachment:local-signature:${token}`);
    if (!validateMeta) {
      throw new BadRequestException('Invalid token');
    }
    const { expiresDate, contentLength, contentType } = validateMeta;

    const { size, mimetype } = file;
    if (Math.floor(Date.now() / 1000) > expiresDate) {
      throw new BadRequestException('Token has expired');
    }
    if (contentLength && contentLength !== size) {
      throw new BadRequestException('Size mismatch');
    }
    if (mimetype && mimetype !== contentType) {
      throw new BadRequestException(`Not allow upload ${mimetype} file`);
    }
  }

  async saveTemporaryFile(req: Request) {
    const name = getRandomString(12);
    const path = resolve(StorageAdapter.TEMPORARY_DIR, name);
    let size = 0;
    return new Promise<ILocalFileUpload>((resolve, reject) => {
      try {
        const fileStream = createWriteStream(path);
        req.on('data', (chunk) => {
          fileStream.write(chunk);
          size += chunk.length;
        });

        req.on('end', () => {
          fileStream.end();
          resolve({
            size,
            mimetype: req.headers['content-type'] as string,
            path,
          });
        });
        req.on('error', (err) => {
          this.deleteFile(path);
          reject(err.message);
        });
        fileStream.on('error', (err) => {
          this.deleteFile(path);
          reject(err.message);
        });
      } catch (error) {
        this.logger.error('saveTemporaryFile error', error);
        this.deleteFile(path);
        reject(error);
      }
    });
  }

  async save(filePath: string, rename: string, isDelete: boolean = true) {
    const distPath = resolve(this.storageDir);
    const newFilePath = resolve(distPath, rename);
    if (!existsSync(newFilePath)) {
      await fse.copy(filePath, newFilePath);
    }
    if (isDelete) {
      this.deleteFile(filePath);
    }
    return join(this.path, rename);
  }

  read(path: string) {
    return createReadStream(resolve(this.storageDir, path));
  }

  getLastModifiedTime(path: string) {
    const url = resolve(this.storageDir, path);
    if (!fse.existsSync(url)) {
      return;
    }
    return fse.statSync(url).mtimeMs;
  }

  async getFileMate(path: string) {
    try {
      const info = await sharp(path).metadata();
      return {
        width: info.width,
        height: info.height,
      };
    } catch (error) {
      return {};
    }
  }

  async getObjectMeta(bucket: string, path: string, token: string): Promise<IObjectMeta> {
    const uploadCache = await this.cacheService.get(`attachment:upload:${token}`);
    if (!uploadCache) {
      throw new BadRequestException(`Invalid token: ${token}`);
    }
    const { mimetype, hash, size } = uploadCache;

    const meta = {
      hash,
      mimetype,
      size,
      url: this.getUrl(bucket, path, {
        respHeaders: { 'Content-Type': mimetype },
        expiresDate: -1,
      }),
    };

    if (!mimetype?.startsWith('image/')) {
      return meta;
    }
    return {
      ...meta,
      ...(await this.getFileMate(resolve(this.storageDir, bucket, path))),
    };
  }

  async getPreviewUrl(
    bucket: string,
    path: string,
    expiresIn: number = second(this.config.urlExpireIn),
    respHeaders?: IRespHeaders
  ): Promise<string> {
    return this.getPreviewUrlInner(bucket, path, expiresIn, respHeaders);
  }

  async getPreviewUrlInner(
    bucket: string,
    path: string,
    expiresIn: number,
    respHeaders?: IRespHeaders
  ) {
    const url = this.getUrl(bucket, path, {
      expiresDate: Math.floor(Date.now() / 1000) + expiresIn,
      respHeaders,
    });
    return this.baseConfig.storagePrefix + join('/', url);
  }
  verifyReadToken(token: string) {
    try {
      const { expiresDate, respHeaders } = this.expireTokenEncryptor.decrypt(token);
      if (expiresDate > 0 && Math.floor(Date.now() / 1000) > expiresDate) {
        throw new BadRequestException('Token has expired');
      }
      return { respHeaders };
    } catch (error) {
      throw new BadRequestException('Invalid token');
    }
  }

  async uploadFileWidthPath(
    bucket: string,
    path: string,
    filePath: string,
    _metadata: Record<string, unknown>
  ) {
    const hash = await FileUtils.getHash(filePath);
    await this.save(filePath, join(bucket, path), false);
    return {
      hash,
      path,
    };
  }

  async uploadFile(
    bucket: string,
    path: string,
    stream: Buffer | ReadableStream,
    _metadata?: Record<string, unknown>
  ) {
    const name = getRandomString(12);
    const temPath = resolve(StorageAdapter.TEMPORARY_DIR, name);
    if (stream instanceof Buffer) {
      await fse.writeFile(temPath, stream);
    } else {
      await new Promise<void>((resolve, reject) => {
        const writer = createWriteStream(temPath);
        stream.pipe(writer);
        stream.on('end', function () {
          writer.end();
          writer.close();
          resolve();
        });
        stream.on('error', (err) => {
          writer.end();
          writer.close();
          this.deleteFile(path);
          reject(err);
        });
      });
    }
    const hash = await FileUtils.getHash(temPath);
    await this.save(temPath, join(bucket, path));
    return {
      hash,
      path,
    };
  }

  async cropImage(
    bucket: string,
    path: string,
    width?: number,
    height?: number,
    _newPath?: string
  ) {
    const newPath = _newPath || `${path}_${width ?? 0}_${height ?? 0}`;
    const resizedImagePath = resolve(this.storageDir, bucket, newPath);
    if (fse.existsSync(resizedImagePath)) {
      return newPath;
    }

    const imagePath = resolve(this.storageDir, bucket, path);
    const image = sharp(imagePath, { failOn: 'none', unlimited: true });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new BadRequestException('Invalid image');
    }
    const resizedImage = image.resize(width, height);
    await resizedImage.toFile(resizedImagePath);
    return newPath;
  }
}
