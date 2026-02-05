import { Injectable, Logger } from '@nestjs/common';
import { getRandomInt } from '@teable/core';
import type { Redis } from 'ioredis';
import Keyv from 'keyv';
import { second } from '../utils/second';
import type { ICacheStore } from './types';

@Injectable()
export class CacheService<T extends ICacheStore = ICacheStore> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly cacheManager: Keyv<any>) {}
  private readonly logger = new Logger(CacheService.name);

  /**
   * Get the underlying Redis client if available
   * Returns undefined if not using Redis
   */
  private getRedisClient(): Redis | undefined {
    try {
      // KeyvRedis stores the Redis client in store.redis
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = this.cacheManager.opts?.store as any;
      return store?.redis || store?.client;
    } catch {
      return undefined;
    }
  }

  /**
   * Atomic set-if-not-exists operation (Redis SETNX with EX)
   * Returns true if the key was set, false if it already existed
   * @param key - The key to set
   * @param value - The value to set
   * @param ttlSeconds - TTL in seconds
   */
  async setnx<TKey extends keyof T>(
    key: TKey,
    value: T[TKey],
    ttlSeconds: number
  ): Promise<boolean> {
    const redis = this.getRedisClient();
    if (!redis) {
      // Fallback for non-Redis: not truly atomic, but better than nothing
      const existing = await this.get(key);
      if (existing !== undefined) {
        return false;
      }
      await this.setDetail(key, value, ttlSeconds);
      return true;
    }

    // Use Redis SET with NX and EX for atomic operation
    const fullKey = `${this.cacheManager.opts.namespace}:${key as string}`;
    const serializedValue = JSON.stringify(value);
    const result = await redis.set(fullKey, serializedValue, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /**
   * Atomic increment operation (Redis INCR with optional EX)
   * Returns the new value after increment
   * @param key - The key to increment
   * @param ttlSeconds - Optional TTL in seconds (only set on first increment)
   */
  async incr<TKey extends keyof T>(key: TKey, ttlSeconds?: number): Promise<number> {
    const redis = this.getRedisClient();
    if (!redis) {
      // Fallback for non-Redis: not truly atomic
      const current = (await this.get(key)) as number | undefined;
      const newValue = (current || 0) + 1;
      await this.setDetail(key, newValue as T[TKey], ttlSeconds);
      return newValue;
    }

    const fullKey = `${this.cacheManager.opts.namespace}:${key as string}`;
    const newValue = await redis.incr(fullKey);

    // Set TTL only if provided and this is the first increment (value is 1)
    if (ttlSeconds && newValue === 1) {
      await redis.expire(fullKey, ttlSeconds);
    }

    return newValue;
  }

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

  /**
   * Update the TTL of an existing key without reading/writing data
   * Returns true if the key exists and TTL was updated
   */
  async expire<TKey extends keyof T>(key: TKey, ttl: number | string): Promise<boolean> {
    const ttlSeconds = typeof ttl === 'string' ? second(ttl) : ttl;
    const redis = this.getRedisClient();
    if (!redis) {
      // Fallback for non-Redis: get and re-set
      const value = await this.get(key);
      if (value !== undefined) {
        await this.setDetail(key, value, ttlSeconds);
        return true;
      }
      return false;
    }

    const fullKey = `${this.cacheManager.opts.namespace}:${key as string}`;
    const result = await redis.expire(fullKey, ttlSeconds);
    return result === 1;
  }
}
