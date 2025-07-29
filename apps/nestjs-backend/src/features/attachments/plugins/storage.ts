/* eslint-disable @typescript-eslint/naming-convention */
import type { Provider } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import { baseConfig, type IBaseConfig } from '../../../configs/base.config';
import type { IStorageConfig } from '../../../configs/storage';
import { storageConfig } from '../../../configs/storage';
import type { IClsStore } from '../../../types/cls';
import { LocalStorage } from './local';
import { MinioStorage } from './minio';
import { S3Storage } from './s3';

const StorageAdapterProvider = Symbol.for('ObjectStorage');

export const InjectStorageAdapter = () => Inject(StorageAdapterProvider);

export const storageAdapterProvider: Provider = {
  provide: StorageAdapterProvider,
  useFactory: (
    config: IStorageConfig,
    baseConfig: IBaseConfig,
    cacheService: CacheService,
    cls: ClsService<IClsStore>
  ) => {
    switch (config.provider) {
      case 'local':
        return new LocalStorage(config, baseConfig, cacheService, cls);
      case 'minio':
        return new MinioStorage(config);
      case 's3':
        return new S3Storage(config);
      default:
        throw new Error('Invalid storage provider');
    }
  },
  inject: [storageConfig.KEY, baseConfig.KEY, CacheService, ClsService],
};
