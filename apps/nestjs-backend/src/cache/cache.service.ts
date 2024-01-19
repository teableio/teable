import sqliteKeyv from '@keyv/sqlite';
import { Injectable } from '@nestjs/common';
import { getRandomInt } from '@teable-group/core';
import * as fse from 'fs-extra';
import keyv from 'keyv';
import { CacheConfig, ICacheConfig } from '../configs/cache.config';
import type { ICacheStore } from './types';

@Injectable()
export class CacheService {
  private cacheManager;
  constructor(@CacheConfig() cacheConfig: ICacheConfig) {
    const { provider, sqlite } = cacheConfig;
    let store;
    // eslint-disable-next-line sonarjs/no-small-switch
    switch (provider) {
      case 'sqlite':
        fse.ensureFileSync(sqlite.uri);
        store = new sqliteKeyv(sqlite);
        break;
      default:
        store = new keyv();
    }
    this.cacheManager = new keyv({ store });
  }

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
