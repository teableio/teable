/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const storageConfig = registerAs('storage', () => ({
  provider: (process.env.BACKEND_STORAGE_PROVIDER ?? 'local') as 'local' | 'minio',
  local: {
    path: process.env.BACKEND_STORAGE_LOCAL_PATH ?? '.assets/uploads',
  },
  publicBucket: process.env.BACKEND_STORAGE_PUBLIC_BUCKET || '',
  privateBucket: process.env.BACKEND_STORAGE_PRIVATE_BUCKET || '',
  minio: {
    endPoint: process.env.BACKEND_STORAGE_MINIO_ENDPOINT,
    port: Number(process.env.BACKEND_STORAGE_MINIO_PORT ?? 9000),
    useSSL: process.env.BACKEND_STORAGE_MINIO_USE_SSL === 'true',
    accessKey: process.env.BACKEND_STORAGE_MINIO_ACCESS_KEY,
    secretKey: process.env.BACKEND_STORAGE_MINIO_SECRET_KEY,
  },
  uploadMethod: process.env.BACKEND_STORAGE_UPLOAD_METHOD ?? 'put',
  encryption: {
    algorithm: process.env.BACKEND_STORAGE_ENCRYPTION_ALGORITHM ?? 'aes-128-cbc',
    key: process.env.BACKEND_STORAGE_ENCRYPTION_KEY ?? '73b00476e456323e',
    iv: process.env.BACKEND_STORAGE_ENCRYPTION_IV ?? '8c9183e4c175f63c',
  },
  tokenExpireIn: process.env.BACKEND_STORAGE_TOKEN_EXPIRE_IN ?? '7d',
  urlExpireIn: process.env.BACKEND_STORAGE_URL_EXPIRE_IN ?? '7d',
}));

export const StorageConfig = () => Inject(storageConfig.KEY);

export type IStorageConfig = ConfigType<typeof storageConfig>;
