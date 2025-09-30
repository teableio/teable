/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const storageConfig = registerAs('storage', () => ({
  provider: (process.env.BACKEND_STORAGE_PROVIDER ?? 'local') as 'local' | 'minio' | 's3',
  local: {
    path: process.env.BACKEND_STORAGE_LOCAL_PATH ?? '.assets/uploads',
  },
  publicUrl: process.env.BACKEND_STORAGE_PUBLIC_URL,
  publicBucket: process.env.BACKEND_STORAGE_PUBLIC_BUCKET || 'public',
  privateBucket: process.env.BACKEND_STORAGE_PRIVATE_BUCKET || 'private',
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
  },
  uploadMethod: process.env.BACKEND_STORAGE_UPLOAD_METHOD ?? 'put',
  encryption: {
    algorithm: process.env.BACKEND_STORAGE_ENCRYPTION_ALGORITHM ?? 'aes-128-cbc',
    key: process.env.BACKEND_STORAGE_ENCRYPTION_KEY ?? '73b00476e456323e',
    iv: process.env.BACKEND_STORAGE_ENCRYPTION_IV ?? '8c9183e4c175f63c',
  },
  // must be less than 7 days
  tokenExpireIn: process.env.BACKEND_STORAGE_TOKEN_EXPIRE_IN ?? '6d',
  urlExpireIn: process.env.BACKEND_STORAGE_URL_EXPIRE_IN ?? '6d',
}));

export const StorageConfig = () => Inject(storageConfig.KEY);

export type IStorageConfig = ConfigType<typeof storageConfig>;
