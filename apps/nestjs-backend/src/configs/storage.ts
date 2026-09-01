/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';
import { resolveCipherEntries } from './secrets/resolve-cipher-entries';
import { SECRET_SPECS } from './secrets/secret-specs';

export const storageConfig = registerAs('storage', () => ({
  provider: (process.env.BACKEND_STORAGE_PROVIDER ?? 'local') as
    | 'local'
    | 'minio'
    | 's3'
    | 'aliyun',
  local: {
    path: process.env.BACKEND_STORAGE_LOCAL_PATH ?? '.assets/uploads',
  },
  publicUrl: process.env.BACKEND_STORAGE_PUBLIC_URL,
  publicBucket: process.env.BACKEND_STORAGE_PUBLIC_BUCKET || 'public',
  privateBucket: process.env.BACKEND_STORAGE_PRIVATE_BUCKET || 'private',
  privateBucketEndpoint: process.env.BACKEND_STORAGE_PRIVATE_BUCKET_ENDPOINT,
  minio: {
    endPoint: process.env.BACKEND_STORAGE_MINIO_ENDPOINT,
    internalEndPoint: process.env.BACKEND_STORAGE_MINIO_INTERNAL_ENDPOINT,
    internalPort: Number(process.env.BACKEND_STORAGE_MINIO_INTERNAL_PORT ?? 9000),
    port: Number(process.env.BACKEND_STORAGE_MINIO_PORT ?? 9000),
    useSSL: process.env.BACKEND_STORAGE_MINIO_USE_SSL === 'true',
    accessKey: process.env.BACKEND_STORAGE_MINIO_ACCESS_KEY,
    secretKey: process.env.BACKEND_STORAGE_MINIO_SECRET_KEY,
    region: process.env.BACKEND_STORAGE_MINIO_REGION,
  },
  s3: {
    region: process.env.BACKEND_STORAGE_S3_REGION!,
    endpoint: process.env.BACKEND_STORAGE_S3_ENDPOINT,
    internalEndpoint: process.env.BACKEND_STORAGE_S3_INTERNAL_ENDPOINT,
    accessKey: process.env.BACKEND_STORAGE_S3_ACCESS_KEY!,
    secretKey: process.env.BACKEND_STORAGE_S3_SECRET_KEY!,
    maxSockets: Number(process.env.BACKEND_STORAGE_S3_MAX_SOCKETS ?? 100),
    // Path-style addressing (https://endpoint/bucket/key) for S3-compatible
    // storage that cannot serve virtual-hosted bucket subdomains. Only affects
    // presigned URLs handed to browsers; the internal client has its own flag
    // below because the two endpoints may differ in addressing support (e.g.
    // a path-style public proxy in front of virtual-hosted-only Aliyun OSS).
    forcePathStyle: process.env.BACKEND_STORAGE_S3_FORCE_PATH_STYLE === 'true',
    // Tri-state: when unset, the internal client inherits forcePathStyle if it
    // shares the public endpoint, and stays virtual-hosted when a separate
    // internal endpoint is configured (its addressing support is independent
    // of the public side's, e.g. Aliyun OSS internal is virtual-hosted-only).
    internalForcePathStyle: process.env.BACKEND_STORAGE_S3_INTERNAL_FORCE_PATH_STYLE
      ? process.env.BACKEND_STORAGE_S3_INTERNAL_FORCE_PATH_STYLE === 'true'
      : undefined,
  },
  uploadMethod: process.env.BACKEND_STORAGE_UPLOAD_METHOD ?? 'put',
  encryption: {
    entries: resolveCipherEntries({
      algorithm: process.env.BACKEND_STORAGE_ENCRYPTION_ALGORITHM ?? 'aes-128-cbc',
      keySpec: SECRET_SPECS.storageEncryptionKey,
      ivSpec: SECRET_SPECS.storageEncryptionIv,
    }),
  },
  // must be less than 7 days
  tokenExpireIn: process.env.BACKEND_STORAGE_TOKEN_EXPIRE_IN ?? '6d',
  urlExpireIn: process.env.BACKEND_STORAGE_URL_EXPIRE_IN ?? '6d',
}));

export const StorageConfig = () => Inject(storageConfig.KEY);

export type IStorageConfig = ConfigType<typeof storageConfig>;
