/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const cacheConfig = registerAs('cache', () => ({
  redis: {
    uri: process.env.BACKEND_CACHE_REDIS_URI,
  },
}));

export const CacheConfig = () => Inject(cacheConfig.KEY);

export type ICacheConfig = ConfigType<typeof cacheConfig>;
