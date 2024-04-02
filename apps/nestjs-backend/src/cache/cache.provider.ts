/* eslint-disable @typescript-eslint/naming-convention */
import path from 'path';
import KeyvRedis from '@keyv/redis';
import KeyvSqlite from '@keyv/sqlite';
import type { Provider } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import * as fse from 'fs-extra';
import Keyv from 'keyv';
import { match } from 'ts-pattern';
import type { ICacheConfig } from '../configs/cache.config';
import { cacheConfig } from '../configs/cache.config';
import { CacheService } from './cache.service';

export const CacheProvider: Provider = {
  provide: CacheService,
  inject: [cacheConfig.KEY],
  useFactory: async (config: ICacheConfig) => {
    const { provider, sqlite, redis } = config;

    Logger.log(`[Cache Manager Adapter]: ${provider}`);

    const store = match(provider)
      .with('memory', () => new Map())
      .with('sqlite', () => {
        const uri = sqlite.uri.replace(/^sqlite:\/\//, '');
        fse.ensureFileSync(uri);

        Logger.log(`[Cache Manager File Path]: ${path.resolve(uri)}`);

        return new KeyvSqlite({
          ...sqlite,
          uri,
        });
      })
      .with('redis', () => new KeyvRedis(redis, { useRedisSets: false }))
      .exhaustive();

    const keyv = new Keyv({ namespace: 'teable_cache', store: store });
    keyv.on('error', (error) => {
      error && Logger.error(error, 'Cache Manager Connection Error');
    });

    Logger.log(`[Cache Manager Namespace]: ${keyv.opts.namespace}`);
    return new CacheService(keyv);
  },
};
