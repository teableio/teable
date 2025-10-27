import { Injectable, Logger } from '@nestjs/common';
import { getRandomInt } from '@teable/core';
import Keyv from 'keyv';
import { second } from '../utils/second';
import type { ICacheStore } from './types';

@Injectable()
export class CacheService<T extends ICacheStore = ICacheStore> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly cacheManager: Keyv<any>) {}
  private readonly logger = new Logger(CacheService.name);

  private warnNotSetTTL(key: string, ttl?: number) {
    if (!ttl || Number.isNaN(ttl) || ttl <= 0) {
      this.logger.warn(`[Cache Service] Not set ttl for key: ${key}`);
    }
  }

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
    this.warnNotSetTTL(key as string, numberTTL);
    await this.cacheManager.set(
      key as string,
      value,
      numberTTL ? (numberTTL + getRandomInt(20, 60)) * 1000 : undefined
    );
  }

  // no add random ttl
  async setDetail<TKey extends keyof T>(
    key: TKey,
    value: T[TKey],
    ttl?: number | string // seconds
  ): Promise<void> {
    const numberTTL = typeof ttl === 'string' ? second(ttl) : ttl;
    this.warnNotSetTTL(key as string, numberTTL);
    await this.cacheManager.set(key as string, value, numberTTL ? numberTTL * 1000 : undefined);
  }

  async del<TKey extends keyof T>(key: TKey): Promise<void> {
    await this.cacheManager.delete(key as string);
  }

  async getMany<TKey extends keyof T>(keys: TKey[]): Promise<Array<T[TKey] | undefined>> {
    return this.cacheManager.get(keys as string[]);
  }
}
