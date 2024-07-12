/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { join } from 'path';
import type { Readable } from 'stream';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import ms from 'ms';
import sharp from 'sharp';
import { IStorageConfig, StorageConfig } from '../../../configs/storage';
import { second } from '../../../utils/second';
import type StorageAdapter from './adapter';
import type { IPresignParams, IPresignRes, IObjectMeta, IRespHeaders } from './types';

@Injectable()
export class S3Storage implements StorageAdapter {
  private s3Client: S3Client;

  constructor(@StorageConfig() readonly config: IStorageConfig) {
    const { endpoint, region, accessKey, secretKey } = this.config.s3;
    this.checkConfig();
    this.s3Client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
    });
  }

  private checkConfig() {
    const { tokenExpireIn } = this.config;
    if (ms(tokenExpireIn) >= ms('7d')) {
      throw new BadRequestException('Token expire in must be more than 7 days');
    }
    if (!this.config.s3.region) {
      throw new BadRequestException('S3 region is required');
    }
    if (!this.config.s3.endpoint) {
      throw new BadRequestException('S3 endpoint is required');
    }
    if (!this.config.s3.accessKey) {
      throw new BadRequestException('S3 access key is required');
    }
    if (!this.config.s3.secretKey) {
      throw new BadRequestException('S3 secret key is required');
    }
    if (this.config.uploadMethod.toLocaleLowerCase() !== 'put') {
      throw new BadRequestException('S3 upload method must be put');
    }
  }

  async presigned(bucket: string, dir: string, params: IPresignParams): Promise<IPresignRes> {
    try {
      const { tokenExpireIn, uploadMethod } = this.config;
      const { expiresIn, contentLength, contentType, hash } = params;

      const token = getRandomString(12);
      const filename = hash ?? token;
      const path = join(dir, filename);

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: path,
        ContentType: contentType,
        ContentLength: contentLength,
      });

      const url = await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresIn ?? second(tokenExpireIn),
      });

      const requestHeaders = {
        'Content-Type': contentType,
        'Content-Length': contentLength,
      };

      return {
        url,
        path,
        token,
        uploadMethod,
        requestHeaders,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new BadRequestException(`S3 presigned error${e?.message ? `: ${e.message}` : ''}`);
    }
  }
  async getObjectMeta(bucket: string, path: string): Promise<IObjectMeta> {
    const url = `/${bucket}/${path}`;
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: path,
    });
    const {
      ContentLength: size,
      ContentType: mimetype,
      ETag: hash,
      Body: stream,
    } = await this.s3Client.send(command);
    if (!size || !mimetype || !hash || !stream) {
      throw new BadRequestException('Invalid object meta');
    }
    if (!mimetype?.startsWith('image/')) {
      return {
        hash,
        size,
        mimetype,
        url,
      };
    }
    const metaReader = sharp();
    const sharpReader = (stream as Readable).pipe(metaReader);
    const { width, height } = await sharpReader.metadata();

    return {
      hash,
      url,
      size,
      mimetype,
      width,
      height,
    };
  }
  getPreviewUrl(
    bucket: string,
    path: string,
    expiresIn: number = second(this.config.urlExpireIn),
    respHeaders?: IRespHeaders
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: path,
      ResponseContentType: respHeaders?.['Content-Type'],
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn: expiresIn ?? second(this.config.tokenExpireIn),
    });
  }
  uploadFileWidthPath(
    bucket: string,
    path: string,
    filePath: string,
    metadata: Record<string, unknown>
  ) {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      Body: filePath,
      ContentType: metadata['Content-Type'] as string,
      ContentLength: metadata['Content-Length'] as number,
      ContentDisposition: metadata['Content-Disposition'] as string,
      ContentEncoding: metadata['Content-Encoding'] as string,
      ContentLanguage: metadata['Content-Language'] as string,
      ContentMD5: metadata['Content-MD5'] as string,
    });

    return this.s3Client.send(command).then((res) => ({
      hash: res.ETag!,
      path,
    }));
  }

  uploadFile(
    bucket: string,
    path: string,
    stream: Buffer | Readable,
    metadata?: Record<string, unknown>
  ) {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      Body: stream,
      ContentType: metadata?.['Content-Type'] as string,
      ContentLength: metadata?.['Content-Length'] as number,
      ContentDisposition: metadata?.['Content-Disposition'] as string,
      ContentEncoding: metadata?.['Content-Encoding'] as string,
      ContentLanguage: metadata?.['Content-Language'] as string,
      ContentMD5: metadata?.['Content-MD5'] as string,
    });

    return this.s3Client.send(command).then((res) => ({
      hash: res.ETag!,
      path,
    }));
  }
}
