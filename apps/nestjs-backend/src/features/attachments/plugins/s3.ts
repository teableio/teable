/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { join, resolve } from 'path';
import type { Readable } from 'stream';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable } from '@nestjs/common';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { getRandomString } from '@teable/core';
import * as fse from 'fs-extra';
import ms from 'ms';
import sharp from 'sharp';
import { IStorageConfig, StorageConfig } from '../../../configs/storage';
import { second } from '../../../utils/second';
import StorageAdapter from './adapter';
import type { IPresignParams, IPresignRes, IObjectMeta, IRespHeaders } from './types';

@Injectable()
export class S3Storage implements StorageAdapter {
  private s3Client: S3Client;
  private s3ClientPrivateNetwork: S3Client;

  constructor(@StorageConfig() readonly config: IStorageConfig) {
    const { endpoint, region, accessKey, secretKey, maxSockets } = this.config.s3;
    this.checkConfig();
    const requestHandler = maxSockets
      ? new NodeHttpHandler({
          httpsAgent: {
            maxSockets: maxSockets,
          },
        })
      : undefined;
    this.s3Client = new S3Client({
      region,
      endpoint,
      requestHandler,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
    });
    this.s3ClientPrivateNetwork = this.s3Client;
    fse.ensureDirSync(StorageAdapter.TEMPORARY_DIR);
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
      const { expiresIn, contentLength, contentType, hash, internal } = params;

      const token = getRandomString(12);
      const filename = hash ?? token;
      const path = join(dir, filename);

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: path,
        ContentType: contentType,
        ContentLength: contentLength,
      });

      const url = await getSignedUrl(
        internal ? this.s3ClientPrivateNetwork : this.s3Client,
        command,
        {
          expiresIn: expiresIn ?? second(tokenExpireIn),
        }
      );

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
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: path,
    });
    const {
      ContentLength: size,
      ContentType: s3Mimetype = 'application/octet-stream',
      ETag: hash,
    } = await this.s3Client.send(command);
    const mimetype = s3Mimetype || 'application/octet-stream';
    if (!size || !mimetype || !hash) {
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
    const getObjectCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: path,
    });
    const { Body } = await this.s3Client.send(getObjectCommand);
    const stream = Body as Readable;
    if (!stream) {
      throw new BadRequestException('Invalid image stream');
    }
    try {
      const sharpReader = stream.pipe(metaReader);
      const { width, height } = await sharpReader.metadata();
      return {
        hash,
        url,
        size,
        mimetype,
        width,
        height,
      };
    } catch (error) {
      throw new BadRequestException(`Calculate image size failed: ${(error as Error).message}`);
    } finally {
      stream?.destroy();
    }
  }
  async getPreviewUrl(
    bucket: string,
    path: string,
    expiresIn: number = second(this.config.urlExpireIn),
    respHeaders?: IRespHeaders
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: path,
      ResponseContentDisposition: respHeaders?.['Content-Disposition'],
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
    const readStream = fse.createReadStream(filePath);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      Body: readStream,
      ContentType: metadata['Content-Type'] as string,
      ContentLength: metadata['Content-Length'] as number,
      ContentDisposition: metadata['Content-Disposition'] as string,
      ContentEncoding: metadata['Content-Encoding'] as string,
      ContentLanguage: metadata['Content-Language'] as string,
      ContentMD5: metadata['Content-MD5'] as string,
    });
    return this.s3Client
      .send(command)
      .then((res) => ({
        hash: res.ETag!,
        path,
      }))
      .finally(() => {
        readStream.removeAllListeners();
        readStream.destroy();
      });
  }

  uploadFile(
    bucket: string,
    path: string,
    stream: Buffer | Readable,
    metadata?: Record<string, unknown>
  ) {
    return this.uploadFileStream(bucket, path, stream, metadata);
  }

  async uploadFileStream(
    bucket: string,
    path: string,
    stream: Buffer | Readable,
    metadata?: Record<string, unknown>
  ) {
    const upload = new Upload({
      client: this.s3ClientPrivateNetwork,
      params: {
        Bucket: bucket,
        Key: path,
        Body: stream,
        ContentType: metadata?.['Content-Type'] as string,
        ContentLength: metadata?.['Content-Length'] as number,
        ContentDisposition: metadata?.['Content-Disposition'] as string,
        ContentEncoding: metadata?.['Content-Encoding'] as string,
        ContentLanguage: metadata?.['Content-Language'] as string,
        ContentMD5: metadata?.['Content-MD5'] as string,
      },
    });

    return upload
      .done()
      .then((res) => ({
        hash: res.ETag!,
        path,
      }))
      .catch((error) => {
        if (stream && typeof stream !== 'string' && 'destroy' in stream) {
          (stream as Readable)?.removeAllListeners?.();
          (stream as Readable)?.destroy?.();
        }
        throw new BadRequestException(`S3 upload failed: ${error?.message || 'Unknown error'}`);
      })
      .finally(() => {
        if (stream && typeof stream !== 'string' && 'destroy' in stream) {
          (stream as Readable)?.removeAllListeners?.();
          (stream as Readable).destroy?.();
        }
      });
  }

  // s3 file exists
  private async fileExists(bucket: string, path: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: path,
      });
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((error as any).name === 'NotFound') {
        return false;
      }
      throw error;
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
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: path,
    });
    const { Body: stream, ContentType: mimetype } = await this.s3Client.send(command);
    if (!mimetype?.startsWith('image/')) {
      throw new BadRequestException('Invalid image');
    }
    if (!stream) {
      throw new BadRequestException("can't get image stream");
    }
    const sourceFilePath = resolve(StorageAdapter.TEMPORARY_DIR, encodeURIComponent(path));
    await new Promise((resolve, reject) => {
      const writeStream = fse.createWriteStream(sourceFilePath);
      (stream as Readable).pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      (stream as Readable).on('error', reject);
    });
    const metaReader = sharp(sourceFilePath, { failOn: 'none', unlimited: true }).resize(
      width,
      height
    );
    await metaReader.toFile(resizedImagePath);
    fse.removeSync(sourceFilePath);
    const upload = await this.uploadFileWidthPath(bucket, newPath, resizedImagePath, {
      'Content-Type': mimetype,
    });
    // delete resized image
    fse.removeSync(resizedImagePath);
    return upload.path;
  }

  async downloadFile(bucket: string, path: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: path,
    });
    const { Body: stream } = await this.s3Client.send(command);
    return stream as Readable;
  }

  async deleteDir(bucket: string, path: string, throwError: boolean = true) {
    const prefix = path.endsWith('/') ? path : `${path}/`;

    const { Contents } = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
      })
    );

    if (!Contents || Contents.length === 0) return;

    try {
      await this.s3Client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: Contents.map((obj) => ({ Key: obj.Key! })),
          },
        })
      );
    } catch (error) {
      if (!throwError) {
        return;
      }
      throw error;
    }
  }
}
