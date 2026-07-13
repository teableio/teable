/* eslint-disable @typescript-eslint/naming-convention */
import type { Readable as ReadableStream } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'path';
import { Injectable } from '@nestjs/common';
import { getRandomString, HttpErrorCode, isImage } from '@teable/core';
import * as fse from 'fs-extra';
import * as minio from 'minio';
import sharp from 'sharp';
import { IStorageConfig, StorageConfig } from '../../../configs/storage';
import { CustomHttpException } from '../../../custom.exception';
import { normalizeImageDimensions } from '../../../utils/image-orientation';
import { second } from '../../../utils/second';
import StorageAdapter from './adapter';
import type {
  IListObjectsOptions,
  IListObjectsResult,
  IPresignParams,
  IPresignRes,
  IRespHeaders,
} from './types';

@Injectable()
export class MinioStorage implements StorageAdapter {
  minioClient: minio.Client;
  minioClientPrivateNetwork: minio.Client;

  constructor(@StorageConfig() readonly config: IStorageConfig) {
    const { endPoint, internalEndPoint, internalPort, port, useSSL, accessKey, secretKey, region } =
      this.config.minio;
    this.minioClient = new minio.Client({
      endPoint: endPoint!,
      port: port!,
      useSSL: useSSL!,
      accessKey: accessKey!,
      secretKey: secretKey!,
      region: region,
    });
    this.minioClientPrivateNetwork = internalEndPoint
      ? new minio.Client({
          endPoint: internalEndPoint,
          port: internalPort,
          useSSL: false,
          accessKey: accessKey!,
          secretKey: secretKey!,
          region: region,
        })
      : this.minioClient;
    fse.ensureDirSync(StorageAdapter.TEMPORARY_DIR);
  }

  async presigned(
    bucket: string,
    dir: string,
    presignedParams: IPresignParams
  ): Promise<IPresignRes> {
    const { tokenExpireIn, uploadMethod } = this.config;
    const { expiresIn, contentLength, contentType, hash, internal } = presignedParams;
    const token = getRandomString(12);
    const filename = hash ?? token;
    const path = join(dir, filename);
    const requestHeaders = {
      'Content-Type': contentType,
      'Content-Length': contentLength,
      'response-cache-control': 'max-age=31536000, immutable',
    };
    try {
      const client = internal ? this.minioClientPrivateNetwork : this.minioClient;
      const url = await client.presignedUrl(
        uploadMethod,
        bucket,
        path,
        expiresIn ?? second(tokenExpireIn),
        requestHeaders
      );
      return {
        url,
        path,
        token,
        uploadMethod,
        requestHeaders,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new CustomHttpException(
        `Minio presigned error${e?.message ? `: ${e.message}` : ''}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.attachment.presignedError',
          },
        }
      );
    }
  }

  private async getShape(bucket: string, objectName: string) {
    const stream = await this.minioClientPrivateNetwork.getObject(bucket, objectName);
    try {
      const metaReader = sharp();
      const sharpReader = stream.pipe(metaReader);
      const metadata = await sharpReader.metadata();

      return normalizeImageDimensions(metadata);
    } catch (e) {
      return {};
    } finally {
      stream.removeAllListeners();
      stream.destroy();
    }
  }

  async getObjectMeta(bucket: string, path: string, _token: string) {
    const objectName = path;
    const {
      metaData,
      size,
      etag: hash,
    } = await this.minioClientPrivateNetwork.statObject(bucket, objectName);
    const mimetype = metaData['content-type'] as string;
    const url = `/${bucket}/${objectName}`;
    if (!isImage(mimetype ?? '')) {
      return {
        hash,
        size,
        mimetype,
        url,
      };
    }
    const sharpMeta = await this.getShape(bucket, objectName);
    return {
      ...sharpMeta,
      hash,
      size,
      mimetype,
      url,
    };
  }

  async getPreviewUrl(
    bucket: string,
    path: string,
    expiresIn: number = second(this.config.urlExpireIn),
    respHeaders?: IRespHeaders
  ) {
    const { 'Content-Disposition': contentDisposition, ...headers } = respHeaders ?? {};
    return this.minioClient.presignedGetObject(bucket, path, expiresIn, {
      ...headers,
      'response-content-disposition': contentDisposition,
    });
  }

  async uploadFileWidthPath(
    bucket: string,
    path: string,
    filePath: string,
    metadata: Record<string, string | number>
  ) {
    const { etag: hash } = await this.minioClientPrivateNetwork.fPutObject(
      bucket,
      path,
      filePath,
      metadata
    );
    return {
      hash,
      path,
    };
  }

  async uploadFile(
    bucket: string,
    path: string,
    stream: Buffer | ReadableStream,
    metadata: Record<string, string | number>
  ) {
    const { etag: hash } = await this.minioClientPrivateNetwork.putObject(
      bucket,
      path,
      stream,
      undefined,
      metadata
    );
    return {
      hash,
      path,
    };
  }

  async uploadFileStream(
    bucket: string,
    path: string,
    stream: Buffer | ReadableStream,
    metadata: Record<string, string | number>
  ) {
    return await this.uploadFile(bucket, path, stream, metadata);
  }

  // minio file exists
  private async fileExists(bucket: string, path: string) {
    try {
      await this.minioClientPrivateNetwork.statObject(bucket, path);
      return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.code === 'NoSuchKey' || err.code === 'NotFound') {
        return false;
      }
      throw err;
    }
  }

  async cropImage(
    bucket: string,
    path: string,
    width?: number,
    height?: number,
    _newPath?: string
  ) {
    const newPath = _newPath || `${path}_${width ?? 0}_${height ?? 0}`;
    const resizedImagePath = resolve(
      StorageAdapter.TEMPORARY_DIR,
      `${encodeURIComponent(join(bucket, newPath))}_${getRandomString(8)}`
    );
    if (await this.fileExists(bucket, newPath)) {
      return newPath;
    }

    const objectName = path;
    const { metaData } = await this.minioClientPrivateNetwork.statObject(bucket, objectName);
    const mimetype = metaData['content-type'] as string;
    if (!isImage(mimetype ?? '')) {
      throw new CustomHttpException('Invalid image', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.attachment.invalidImage',
        },
      });
    }
    const sourceFilePath = resolve(
      StorageAdapter.TEMPORARY_DIR,
      `${encodeURIComponent(path)}_${getRandomString(8)}`
    );
    try {
      const stream = await this.minioClientPrivateNetwork.getObject(bucket, objectName);
      await pipeline(stream, fse.createWriteStream(sourceFilePath));
      const metaReader = sharp(sourceFilePath, { failOn: 'none', unlimited: true })
        .rotate()
        .resize(width, height);
      await metaReader.toFile(resizedImagePath);
      const upload = await this.uploadFileWidthPath(bucket, newPath, resizedImagePath, {
        'Content-Type': mimetype,
      });
      return upload.path;
    } finally {
      fse.removeSync(sourceFilePath);
      fse.removeSync(resizedImagePath);
    }
  }

  async downloadFile(bucket: string, path: string): Promise<ReadableStream> {
    return this.minioClientPrivateNetwork.getObject(bucket, path);
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    await this.minioClientPrivateNetwork.removeObject(bucket, path);
  }

  async listObjects(
    bucket: string,
    prefix: string,
    options?: IListObjectsOptions
  ): Promise<IListObjectsResult> {
    const objects: IListObjectsResult['objects'] = [];
    const prefixes = new Set<string>();
    // minio: recursive=false groups keys at '/' into prefix entries, matching S3 delimiter='/'
    const recursive = !options?.delimiter;
    const stream = this.minioClientPrivateNetwork.listObjects(bucket, prefix, recursive);
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (obj) => {
        if (obj.name) {
          objects.push({ key: obj.name, size: obj.size ?? 0, etag: obj.etag ?? undefined });
        } else if (obj.prefix) {
          prefixes.add(obj.prefix);
        }
      });
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    return { objects, prefixes: [...prefixes] };
  }

  async deleteDir(bucket: string, path: string, throwError: boolean = true): Promise<void> {
    try {
      const prefix = path.endsWith('/') ? path : `${path}/`;

      const objectsList: string[] = [];
      const objectsStream = this.minioClientPrivateNetwork.listObjects(bucket, prefix, true);

      await new Promise((resolve, reject) => {
        objectsStream.on('data', (obj) => {
          if (obj.name) {
            objectsList.push(obj.name);
          }
        });

        objectsStream.on('end', resolve);
        objectsStream.on('error', reject);
      });

      if (objectsList.length === 0) {
        return;
      }

      await this.minioClientPrivateNetwork.removeObjects(bucket, objectsList);
    } catch (error) {
      if (!throwError) {
        return;
      }
      throw new CustomHttpException(
        `Failed to delete directory "${path}" in bucket "${bucket}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.attachment.failedToDeleteDirectory',
          },
        }
      );
    }
  }
}
