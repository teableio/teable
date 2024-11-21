import { Injectable } from '@nestjs/common';
import { getRandomInt } from '@teable/core';
import Keyv from 'keyv';
import { second } from '../utils/second';
import type { ICacheStore } from './types';

@Injectable()
export class CacheService<T extends ICacheStore = ICacheStore> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly cacheManager: Keyv<any>) {}

  async get<TKey extends keyof T>(key: TKey): Promise<T[TKey] | undefined> {
    return this.cacheManager.get(key as string);
  }

  async set<TKey extends keyof T>(
    key: TKey,
    value: T[TKey],
    // seconds, and will add random 20-60 seconds
    ttl?: number | string
  ): Promise<void> {
    const numberTTL = typeof ttl === 'string' ? second(ttl) : ttl;
    await this.cacheManager.set(
      key as string,
      value,
      numberTTL ? (numberTTL + getRandomInt(20, 60)) * 1000 : undefined
    );
  }

  async del<TKey extends keyof T>(key: TKey): Promise<void> {
    await this.cacheManager.delete(key as string);
  }

  async getMany<TKey extends keyof T>(keys: TKey[]): Promise<Array<T[TKey] | undefined>> {
    return this.cacheManager.get(keys as string[]);
  }
}
