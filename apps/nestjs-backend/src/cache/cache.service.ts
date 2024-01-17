import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Injectable, Inject } from '@nestjs/common';
import { getRandomInt } from '@teable-group/core';
import { Cache } from 'cache-manager';
import type { ICacheStore } from './types';

@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async get<TKey extends keyof ICacheStore>(key: TKey) {
    return this.cacheManager.get<ICacheStore[TKey]>(key);
  }

  async set<TKey extends keyof ICacheStore>(
    key: TKey,
    value: ICacheStore[TKey],
    ttl?: number
  ): Promise<void> {
    await this.cacheManager.set(key, value, ttl ? (ttl + getRandomInt(20, 60)) * 1000 : undefined);
  }

  async del<TKey extends keyof ICacheStore>(key: TKey): Promise<void> {
    await this.cacheManager.del(key);
  }

  async keys(pattern?: string): Promise<string[]> {
    return this.cacheManager.store.keys(pattern);
  }
}
