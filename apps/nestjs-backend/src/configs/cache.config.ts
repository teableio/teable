/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const cacheConfig = registerAs('cache', () => ({
  provider: process.env.BACKEND_CACHE_PROVIDER ?? 'sqlite',
  sqlite: {
    uri: process.env.BACKEND_CACHE_SQLITE_URI ?? '.assets/.cache.db',
  },
}));

export const CacheConfig = () => Inject(cacheConfig.KEY);

export type ICacheConfig = ConfigType<typeof cacheConfig>;
