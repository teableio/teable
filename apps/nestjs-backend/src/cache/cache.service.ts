import { Injectable, Logger } from '@nestjs/common';
import { getRandomInt } from '@teable/core';
import type { Redis } from 'ioredis';
import Keyv from 'keyv';
import { second } from '../utils/second';
import type { ICacheStore } from './types';

/** INCR, then attach the expiry whenever the key has none (fresh or orphaned). */
const INCR_WITH_EXPIRY_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

@Injectable()
export class CacheService<T extends ICacheStore = ICacheStore> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly cacheManager: Keyv<any>) {}
  private readonly logger = new Logger(CacheService.name);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getKeyv(): Keyv<any> {
    return this.cacheManager;
  }

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
   * Physical Redis key for `key`, exactly as the keyv stack lays it out: the
   * keyv namespace prefix, then the store's own key naming (KeyvRedis with
   * `useRedisSets: false` adds `sets:namespace:<ns>:` on top). Asking the
   * store for its name instead of hand-building the layout is what keeps raw
   * commands and the keyv read path pointed at the same bytes — a hand-built
   * `namespace:key` silently diverged from the real layout, so keys written
   * by raw commands were invisible to get()/del().
   */
  private getRedisKey(key: string): string {
    const prefixed = `${this.cacheManager.opts.namespace}:${key}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = this.cacheManager.opts?.store as any;
    return typeof store?._getKeyName === 'function' ? store._getKeyName(prefixed) : prefixed;
  }

  /**
   * The envelope keyv wraps every value in (`{value, expires}`), produced with
   * the instance's own serializer — this is what makes a raw-written key
   * readable back through get().
   */
  private serializeEnvelope(value: unknown, ttlSeconds: number): string {
    const serialize = this.cacheManager.opts.serialize ?? JSON.stringify;
    return serialize({ value, expires: Date.now() + ttlSeconds * 1000 }) as string;
  }

  /**
   * Atomic set-if-not-exists operation (Redis SET NX EX).
   * Returns true if the key was set, false if it already existed.
   *
   * Fully interoperable with get()/del(): the write lands on the same
   * physical key, in the same envelope, as a set() would.
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

    const result = await redis.set(
      this.getRedisKey(key as string),
      this.serializeEnvelope(value, ttlSeconds),
      'EX',
      ttlSeconds,
      'NX'
    );
    return result === 'OK';
  }

  /**
   * Atomic increment operation (Redis INCR with optional EX).
   * Returns the new value after increment.
   *
   * The counter is NOT readable via get(): atomic INCR requires a bare
   * integer on the wire, which the keyv envelope cannot carry. Read the
   * count only from this method's return value. del() does work on it.
   *
   * With a ttl, INCR and EXPIRE run in one Lua script, and a counter that has
   * no expiry (fresh or orphaned) gets one on its next increment.
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

    const fullKey = this.getRedisKey(key as string);
    if (!ttlSeconds) {
      return redis.incr(fullKey);
    }

    const newValue = await redis.eval(INCR_WITH_EXPIRY_SCRIPT, 1, fullKey, ttlSeconds);
    return Number(newValue);
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

  // Returns true if the key existed and was deleted, so callers can use it
  // as an atomic consume for one-time tokens.
  async del<TKey extends keyof T>(key: TKey): Promise<boolean> {
    return await this.cacheManager.delete(key as string);
  }

  async getMany<TKey extends keyof T>(keys: TKey[]): Promise<Array<T[TKey] | undefined>> {
    // Redis-backed stores forward this to MGET, which rejects an empty key list
    if (keys.length === 0) {
      return [];
    }
    return this.cacheManager.get(keys as string[]);
  }

  /**
   * Update the TTL of an existing key without reading/writing data.
   * Returns true if the key exists and TTL was updated.
   *
   * Only safe for SHORTENING the life of set()/setnx()-written values: their
   * keyv envelope embeds an absolute `expires` that get() honors regardless of
   * the Redis TTL, so an extension keeps the key alive but not readable.
   * incr() counters carry no envelope and can go either way.
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

    const result = await redis.expire(this.getRedisKey(key as string), ttlSeconds);
    return result === 1;
  }
}
