import { MapCacheAdapter } from '@soluble/cache-interop';
import {
  getIoRedisOptionsFromDsn,
  IoRedisCacheAdapter,
} from '@soluble/cache-ioredis';

const appCacheDsn = process.env?.APP_CACHE_DSN ?? null;

export const appCache = !appCacheDsn
  ? new MapCacheAdapter()
  : new IoRedisCacheAdapter({
      connection: getIoRedisOptionsFromDsn(appCacheDsn, {
        connectTimeout: 3_000,
        maxRetriesPerRequest: 2,
      }),
    });
