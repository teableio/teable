/* eslint-disable @typescript-eslint/naming-convention */
import type { Readable as ReadableStream } from 'node:stream';
import { join, resolve } from 'path';
import { BadRequestException, Injectable } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import * as fse from 'fs-extra';
import * as minio from 'minio';
import sharp from 'sharp';
import { IStorageConfig, StorageConfig } from '../../../configs/storage';
import { second } from '../../../utils/second';
import StorageAdapter from './adapter';
import type { IPresignParams, IPresignRes, IRespHeaders } from './types';

@Injectable()
export class MinioStorage implements StorageAdapter {
  minioClient: minio.Client;
  minioClientPrivateNetwork: minio.Client;

  constructor(@StorageConfig() readonly config: IStorageConfig) {
    const { endPoint, internalEndPoint, internalPort, port, useSSL, accessKey, secretKey } =
      this.config.minio;
    this.minioClient = new minio.Client({
      endPoint: endPoint!,
      port: port!,
      useSSL: useSSL!,
      accessKey: accessKey!,
      secretKey: secretKey!,
    });
    this.minioClientPrivateNetwork = internalEndPoint
      ? new minio.Client({
          endPoint: internalEndPoint,
          port: internalPort,
          useSSL: false,
          accessKey: accessKey!,
          secretKey: secretKey!,
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
      throw new BadRequestException(`Minio presigned error${e?.message ? `: ${e.message}` : ''}`);
    }
  }

  private async getShape(bucket: string, objectName: string) {
    const stream = await this.minioClientPrivateNetwork.getObject(bucket, objectName);
    try {
      const metaReader = sharp();
      const sharpReader = stream.pipe(metaReader);
      const { width, height } = await sharpReader.metadata();

      return {
        width,
        height,
      };
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
    if (!mimetype?.startsWith('image/')) {
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
      encodeURIComponent(join(bucket, newPath))
    );
    if (await this.fileExists(bucket, newPath)) {
      return newPath;
    }

    const objectName = path;
    const { metaData } = await this.minioClientPrivateNetwork.statObject(bucket, objectName);
    const mimetype = metaData['content-type'] as string;
    if (!mimetype?.startsWith('image/')) {
      throw new BadRequestException('Invalid image');
    }
    const sourceFilePath = resolve(StorageAdapter.TEMPORARY_DIR, encodeURIComponent(path));
    // stream save in sourceFilePath
    const writeStream = fse.createWriteStream(sourceFilePath);
    try {
      await new Promise((resolve, reject) => {
        this.minioClientPrivateNetwork
          .getObject(bucket, objectName)
          .then((stream) => {
            stream.pipe(writeStream);
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            stream.on('error', reject);
          })
          .catch(reject);
      });
    } catch (e) {
      fse.removeSync(sourceFilePath);
      throw e;
    } finally {
      writeStream.removeAllListeners();
      writeStream.destroy();
    }
    const metaReader = sharp(sourceFilePath, { failOn: 'none', unlimited: true }).resize(
      width,
      height
    );
    await metaReader.toFile(resizedImagePath);
    // delete source file
    fse.removeSync(sourceFilePath);

    const upload = await this.uploadFileWidthPath(bucket, newPath, resizedImagePath, {
      'Content-Type': mimetype,
    });
    // delete resized image
    fse.removeSync(resizedImagePath);
    return upload.path;
  }
}
