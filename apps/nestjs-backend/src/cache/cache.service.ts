import { Injectable } from '@nestjs/common';
import { getRandomInt } from '@teable/core';
import Keyv from 'keyv';
import { second } from '../utils/second';
import type { ICacheStore } from './types';

@Injectable()
export class CacheService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly cacheManager: Keyv<any>) {}

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

  async getMany<TKey extends keyof ICacheStore>(
    keys: TKey[]
  ): Promise<Array<ICacheStore[TKey] | undefined>> {
    return this.cacheManager.get(keys);
  }
}
