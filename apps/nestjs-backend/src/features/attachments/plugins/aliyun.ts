/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { IStorageConfig, StorageConfig } from '../../../configs/storage';
import { second } from '../../../utils/second';
import type StorageAdapter from './adapter';
import { S3Storage } from './s3';
import type { IRespHeaders } from './types';

@Injectable()
export class AliyunStorage extends S3Storage implements StorageAdapter {
  private aliyunClient: S3Client;

  constructor(@StorageConfig() readonly config: IStorageConfig) {
    super(config);
    const { endpoint, region, accessKey, secretKey, maxSockets } = this.config.s3;
    const requestHandler = maxSockets
      ? new NodeHttpHandler({
          httpsAgent: {
            maxSockets: maxSockets,
          },
        })
      : undefined;
    this.aliyunClient = new S3Client({
      region,
      endpoint,
      requestHandler,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
    });
  }

  private replacePrivateBucketEndpoint(url: string, bucket: string) {
    const { privateBucketEndpoint, privateBucket } = this.config;
    if (privateBucketEndpoint && bucket === privateBucket) {
      const resUrl = new URL(url);
      const newUrl = new URL(privateBucketEndpoint);
      resUrl.protocol = newUrl.protocol;
      resUrl.hostname = newUrl.hostname;
      resUrl.port = newUrl.port;
      return resUrl.toString();
    }
    return url;
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

    const res = await getSignedUrl(this.aliyunClient, command, {
      expiresIn: expiresIn ?? second(this.config.tokenExpireIn),
    });
    return this.replacePrivateBucketEndpoint(res, bucket);
  }
}
