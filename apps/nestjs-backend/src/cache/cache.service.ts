import { Injectable } from '@nestjs/common';
import { getRandomInt } from '@teable/core';
import { type Store } from 'keyv';
import type { ICacheStore } from './types';

@Injectable()
export class CacheService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly cacheManager: Store<any>) {}

  async get<TKey extends keyof ICacheStore>(key: TKey): Promise<ICacheStore[TKey] | undefined> {
    return this.cacheManager.get(key);
  }

  async set<TKey extends keyof ICacheStore>(
    key: TKey,
    value: ICacheStore[TKey],
    ttl?: number
  ): Promise<void> {
    await this.cacheManager.set(key, value, ttl ? (ttl + getRandomInt(20, 60)) * 1000 : undefined);
  }

  async del<TKey extends keyof ICacheStore>(key: TKey): Promise<void> {
    await this.cacheManager.delete(key);
  }
}
