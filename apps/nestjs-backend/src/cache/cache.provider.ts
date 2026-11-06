/* eslint-disable @typescript-eslint/naming-convention */
import KeyvRedis from '@keyv/redis';
import type { Provider } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import Keyv from 'keyv';
import type { ICacheConfig } from '../configs/cache.config';
import { cacheConfig } from '../configs/cache.config';
import { CacheService } from './cache.service';

export const CacheProvider: Provider = {
  provide: CacheService,
  inject: [cacheConfig.KEY],
  useFactory: async (config: ICacheConfig) => {
    const store = new KeyvRedis(config.redis, { useRedisSets: false });

    const keyv = new Keyv({ namespace: 'teable_cache', store: store });
    keyv.on('error', (error) => {
      error && Logger.error(error, 'Cache Manager Connection Error');
    });

    Logger.log(`[Cache Manager Namespace]: ${keyv.opts.namespace}`);
    return new CacheService(keyv);
  },
};
