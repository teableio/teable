/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const cacheConfig = registerAs('cache', () => ({
  provider: (process.env.BACKEND_CACHE_PROVIDER ?? 'sqlite') as 'memory' | 'sqlite' | 'redis',
  sqlite: {
    uri: process.env.BACKEND_CACHE_SQLITE_URI ?? 'sqlite://.assets/.cache.db',
  },
  redis: {
    uri: process.env.BACKEND_CACHE_REDIS_URI,
  },
}));

export const CacheConfig = () => Inject(cacheConfig.KEY);

export type ICacheConfig = ConfigType<typeof cacheConfig>;
