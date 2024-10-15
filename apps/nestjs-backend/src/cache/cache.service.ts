import { Injectable } from '@nestjs/common';
import { getRandomInt } from '@teable/core';
import { type Keyv } from 'keyv';
import { second } from '../utils/second';
import type { ICacheStore } from './types';

@Injectable()
export class CacheService {
  constructor(private readonly cacheManager: Keyv) {}

  async get<TKey extends keyof ICacheStore>(key: TKey): Promise<ICacheStore[TKey] | undefined> {
    return this.cacheManager.get(key);
  }

  async set<TKey extends keyof ICacheStore>(
    key: TKey,
    value: ICacheStore[TKey],
    // seconds, and will add random 20-60 seconds
    ttl?: number | string
  ): Promise<void> {
    const numberTTL = typeof ttl === 'string' ? second(ttl) : ttl;
    await this.cacheManager.set(
      key,
      value,
      numberTTL ? (numberTTL + getRandomInt(20, 60)) * 1000 : undefined
    );
  }

  async del<TKey extends keyof ICacheStore>(key: TKey): Promise<void> {
    await this.cacheManager.delete(key);
  }
}
