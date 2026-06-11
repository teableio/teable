import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CacheService } from './cache.service';

/**
 * Type-safe wrapper around the ioredis client obtained from CacheService.
 *
 * Provides:
 * - Normalized return types (e.g. `exists` → boolean, `sismember` → boolean)
 * - Defensive guards (empty array protection for variadic commands)
 * - Consistent error when Redis is unavailable
 */
@Injectable()
export class RedisNativeService {
  private readonly logger = new Logger(RedisNativeService.name);
  private readonly redis: Redis | undefined;

  constructor(cacheService: CacheService) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = cacheService.getKeyv().opts?.store as any;
      this.redis = store?.redis || store?.client;
    } catch {
      this.redis = undefined;
    }
    if (!this.redis) {
      this.logger.warn('Redis client not available — RedisNativeService disabled');
    }
  }

  private get client(): Redis {
    if (!this.redis) {
      throw new Error('RedisNativeService: Redis is not available (cache provider is not redis)');
    }
    return this.redis;
  }

  /**
   * Get the value of a string key.
   * @param key - Redis key
   * @returns Value string, or null if key doesn't exist
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /**
   * Set multiple fields on a hash key atomically. No-op if fields is empty.
   * @param key - Redis hash key
   * @param fields - Key-value pairs to set
   */
  async hset(key: string, fields: Record<string, string>): Promise<void> {
    const entries = Object.entries(fields).flat();
    if (entries.length > 0) {
      await this.client.hset(key, ...entries);
    }
  }

  /**
   * Get all fields and values of a hash.
   * @param key - Redis hash key
   * @returns All field-value pairs, or null if key doesn't exist
   */
  async hgetall(key: string): Promise<Record<string, string> | null> {
    const result = await this.client.hgetall(key);
    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Get a single field value from a hash.
   * @param key - Redis hash key
   * @param field - Field name within the hash
   * @returns Field value, or null if field or key doesn't exist
   */
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  /**
   * Get multiple field values from a hash in a single round-trip.
   * @param key - Redis hash key
   * @param fields - Field names to fetch
   * @returns Array of values in the same order as fields (null for missing fields)
   */
  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    if (fields.length === 0) return [];
    return this.client.hmget(key, ...fields);
  }

  /**
   * Delete one or more fields from a hash. No-op if fields list is empty.
   * @param key - Redis hash key
   * @param fields - Field names to delete
   */
  async hdel(key: string, ...fields: string[]): Promise<void> {
    if (fields.length > 0) {
      await this.client.hdel(key, ...fields);
    }
  }

  /**
   * Set a TTL (time-to-live) on an existing key.
   * @param key - Redis key
   * @param seconds - TTL in seconds
   */
  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  /**
   * Get remaining TTL (in seconds) for a key.
   * Redis semantics:
   * - -2: key does not exist
   * - -1: key exists but has no associated expire
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Delete a key.
   * @param key - Redis key to delete
   */
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Check if a key exists.
   * @param key - Redis key
   * @returns true if the key exists, false otherwise
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  /**
   * Set a key with a value and TTL (SETEX command).
   * @param key - Redis key
   * @param seconds - TTL in seconds
   * @param value - Value to store
   */
  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.client.setex(key, seconds, value);
  }

  /**
   * Atomic set-if-not-exists with TTL (SET key value NX EX seconds).
   * @param key - Redis key
   * @param seconds - TTL in seconds
   * @param value - Value to store
   * @returns true if the key was set (didn't exist), false if it already existed
   */
  async setnxex(key: string, seconds: number, value: string): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', seconds, 'NX');
    return result === 'OK';
  }

  /**
   * Add a member with a score to a sorted set.
   * @param key - Redis sorted set key
   * @param score - Score for ordering
   * @param member - Member value
   */
  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member);
  }

  /**
   * Get all members with scores in the given range (inclusive).
   * @param key - Redis sorted set key
   * @param min - Minimum score (number or '-inf')
   * @param max - Maximum score (number or '+inf')
   * @returns Array of member values within the score range
   */
  async zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max);
  }

  /**
   * Remove one or more members from a sorted set. No-op if members list is empty.
   * @param key - Redis sorted set key
   * @param members - Members to remove
   */
  async zrem(key: string, ...members: string[]): Promise<void> {
    if (members.length > 0) {
      await this.client.zrem(key, ...members);
    }
  }

  /**
   * Add one or more members to a set. No-op if members list is empty.
   * @param key - Redis set key
   * @param members - Members to add
   * @returns Number of new members actually added (excludes already-existing)
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.sadd(key, ...members);
  }

  /**
   * Remove one or more members from a set. No-op if members list is empty.
   * @param key - Redis set key
   * @param members - Members to remove
   * @returns Number of members actually removed
   */
  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.srem(key, ...members);
  }

  /**
   * Check if a member exists in a set.
   * @param key - Redis set key
   * @param member - Member to check
   * @returns true if the member exists in the set, false otherwise
   */
  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  /**
   * Get the number of members in a set (cardinality).
   * @param key - Redis set key
   * @returns Number of members in the set
   */
  async scard(key: string): Promise<number> {
    return this.client.scard(key);
  }

  /**
   * Execute a Lua script atomically on the Redis server.
   * @param script - Lua script source code
   * @param keys - KEYS array accessible in Lua as KEYS[1], KEYS[2], ...
   * @param args - ARGV array accessible in Lua as ARGV[1], ARGV[2], ...
   * @returns Script return value (type depends on the Lua script)
   */
  async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    return this.client.eval(script, keys.length, ...keys, ...args);
  }

  /**
   * Execute multiple commands in a single network roundtrip (pipeline).
   * @param commands - Array of operations, each with an op type, key, and optional args
   */
  async pipeline(
    commands: Array<{ op: 'del' | 'zrem' | 'srem'; key: string; args?: string[] }>
  ): Promise<void> {
    const pipe = this.client.pipeline();
    for (const cmd of commands) {
      switch (cmd.op) {
        case 'del':
          pipe.del(cmd.key);
          break;
        case 'zrem':
          if (cmd.args && cmd.args.length > 0) {
            pipe.zrem(cmd.key, ...cmd.args);
          }
          break;
        case 'srem':
          if (cmd.args && cmd.args.length > 0) {
            pipe.srem(cmd.key, ...cmd.args);
          }
          break;
      }
    }
    await pipe.exec();
  }

  /**
   * Batch HGETALL via pipeline — single network roundtrip for multiple hash keys.
   * @param keys - Array of Redis hash keys
   * @returns Array of field-value maps (null for missing/empty hashes)
   */
  async hgetallMulti(keys: string[]): Promise<Array<Record<string, string> | null>> {
    if (keys.length === 0) return [];
    const pipe = this.client.pipeline();
    for (const key of keys) {
      pipe.hgetall(key);
    }
    const replies = await pipe.exec();
    return keys.map((_, i) => {
      const [err, raw] = replies?.[i] ?? [null, null];
      if (err || !raw || typeof raw !== 'object' || Object.keys(raw as object).length === 0) {
        return null;
      }
      return raw as Record<string, string>;
    });
  }

  /**
   * Batch SCARD via pipeline — single network roundtrip for multiple set keys.
   * @param keys - Array of Redis set keys
   * @returns Array of cardinalities (0 for missing keys or errors)
   */
  async scardMulti(keys: string[]): Promise<number[]> {
    if (keys.length === 0) return [];
    const pipe = this.client.pipeline();
    for (const key of keys) {
      pipe.scard(key);
    }
    const replies = await pipe.exec();
    return keys.map((_, i) => {
      const [err, count] = replies?.[i] ?? [null, 0];
      return err ? 0 : (count as number) ?? 0;
    });
  }

  /**
   * Batch EXISTS via pipeline — single network roundtrip for multiple keys.
   * @param keys - Array of Redis keys
   * @returns Array of booleans (true if key exists)
   */
  async existsMulti(keys: string[]): Promise<boolean[]> {
    if (keys.length === 0) return [];
    const pipe = this.client.pipeline();
    for (const key of keys) {
      pipe.exists(key);
    }
    const replies = await pipe.exec();
    return keys.map((_, i) => {
      const [err, result] = replies?.[i] ?? [null, 0];
      return err ? false : (result as number) === 1;
    });
  }
}
