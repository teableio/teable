/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { IStorageConfig, StorageConfig } from '../../../configs/storage';
import { second } from '../../../utils/second';
import StorageAdapter from './adapter';
import { S3Storage } from './s3';
import type { IRespHeaders } from './types';

@Injectable()
export class AliyunStorage extends S3Storage implements StorageAdapter {
  private readonly aliyunClient: S3Client;

  constructor(@StorageConfig() readonly config: IStorageConfig) {
    super(config);
    const { endpoint, region, accessKey, secretKey, maxSockets, forcePathStyle } = this.config.s3;
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
      forcePathStyle,
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
      // Unlike S3 (see s3.ts), Aliyun OSS rejects GET requests that carry a
      // response-content-type override with 400 InvalidRequest
      // (EC 0017-00000902: "Can not override response header on content-type"),
      // so the Content-Type response header is intentionally not forwarded here.
      // The Safari sniffing workaround is not needed on OSS either: a PUT
      // without Content-Type is stored as application/octet-stream (object
      // keys carry no extension, so OSS cannot infer anything else), and
      // browsers save octet-stream downloads as-is instead of sniffing them.
      // S3 by contrast stores such objects with no Content-Type at all.
      ResponseCacheControl: StorageAdapter.isPublicBucket(bucket)
        ? undefined
        : StorageAdapter.PRIVATE_PREVIEW_CACHE_CONTROL,
    });

    const res = await getSignedUrl(this.aliyunClient, command, {
      expiresIn: expiresIn ?? second(this.config.tokenExpireIn),
    });
    return this.replacePrivateBucketEndpoint(res, bucket);
  }
}
