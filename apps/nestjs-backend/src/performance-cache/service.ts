/* eslint-disable @typescript-eslint/no-explicit-any */
import KeyvRedis from '@keyv/redis';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Keyv from 'keyv';
import Redlock, { ExecutionError, ResourceLockedError } from 'redlock';
import type { ICacheOptions, ICacheStats, IPerformanceCacheStore } from './types';

@Injectable()
export class PerformanceCacheService<T extends IPerformanceCacheStore = IPerformanceCacheStore> {
  private readonly logger = new Logger(PerformanceCacheService.name);
  private keyv!: Keyv;
  private redlock?: Redlock;
  private enabled = false;
  private typeStats: Partial<Record<string, { hits: number; misses: number }>> = {};

  private stats: ICacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
  };

  private readonly lockPrefix = 'perf:lock';

  constructor(private readonly configService: ConfigService) {
    try {
      const redisUri = this.configService.get<string>('BACKEND_PERFORMANCE_CACHE');

      if (!redisUri) {
        this.logger.warn(
          'Performance cache is disabled - BACKEND_PERFORMANCE_CACHE not configured'
        );
        return;
      }

      this.enabled = true;

      // Initialize Keyv for caching
      const store = new KeyvRedis(redisUri, { useRedisSets: false });
      this.keyv = new Keyv({ namespace: 'teable_perf', store });

      this.keyv.on('error', (error) => {
        this.logger.error('Performance cache connection error:', error);
        this.stats.errors++;
      });

      // Initialize Redlock for distributed locking
      this.redlock = new Redlock([store.redis], {
        driftFactor: 0.01, // 1% drift tolerance
        retryCount: 10, // Retry 10 times before giving up
        retryDelay: 300, // 300ms base delay between retries
        retryJitter: 100, // Add up to 100ms random jitter
        automaticExtensionThreshold: 500, // Auto-extend if <500ms remaining
      });

      this.redlock.on('error', (error) => {
        // Check if it's a ResourceLockedError (normal during contention)
        if (error.name === 'ResourceLockedError') {
          this.logger.debug('Resource locked (normal contention):', error.message);
        } else {
          this.logger.error('Redlock error:', error);
          this.stats.errors++;
        }
      });

      this.logger.log('Performance cache initialized with Redis and Redlock');
    } catch (error) {
      this.logger.error('Failed to initialize performance cache:', error);
      this.stats.errors++;
    }
  }

  private recordTypeStats(type: 'hits' | 'misses', cacheType?: string) {
    if (!cacheType) {
      return;
    }
    const stats = this.typeStats[cacheType] || { hits: 0, misses: 0 };
    if (type === 'hits') stats.hits++;
    else stats.misses++;
    this.typeStats[cacheType] = stats;
  }

  /**
   * Check if cache is available
   */
  private isAvailable(): boolean {
    return this.enabled && this.keyv != null;
  }

  /**
   * Check if redlock is available
   */
  private isRedlockAvailable(): boolean {
    return this.enabled && this.redlock != null;
  }

  private setValueToKeyv(key: string, value: T[keyof T], ttlMs: number | undefined) {
    return this.keyv.set(key as string, { data: value }, ttlMs);
  }

  /**
   * Get cache value
   */
  async get<TKey extends keyof T>(key: TKey, options: ICacheOptions = {}) {
    if (!this.isAvailable() || options.skipGet) {
      return null;
    }
    try {
      const value = await this.keyv.get(key as string);
      if (value == undefined) {
        this.stats.misses++;
        this.recordTypeStats('misses', options.statsType);
        return null;
      }

      this.stats.hits++;
      this.recordTypeStats('hits', options.statsType);
      return value as { data: T[TKey] };
    } catch (error) {
      this.logger.error('Error getting cache value:', error);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Set cache value
   */
  async set<TKey extends keyof T>(
    key: TKey,
    value: T[TKey],
    options: ICacheOptions = {}
  ): Promise<void> {
    if (!this.isAvailable() || options.skipSet) {
      return;
    }

    if (options.ttl == undefined) {
      throw new Error('ttl is required');
    }

    try {
      const ttlMs = options.ttl ? options.ttl * 1000 : undefined;

      await this.setValueToKeyv(key as string, value, ttlMs);
      this.stats.sets++;
    } catch (error) {
      this.logger.error('Error setting cache value:', error);
      this.stats.errors++;
    }
  }

  /**
   * Delete cache value
   */
  async del<TKey extends keyof T>(key: TKey): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    try {
      await this.keyv.delete(key as string);
      this.stats.deletes++;
    } catch (error) {
      this.logger.error('Error deleting cache value:', error);
      this.stats.errors++;
    }
  }

  /**
   * Batch get cache values
   */
  async mget<TKey extends keyof T>(
    keys: TKey[],
    options: ICacheOptions = {}
  ): Promise<Array<T[TKey] | null>> {
    if (!this.isAvailable() || options.skipGet) {
      return keys.map(() => null);
    }

    try {
      const values = await this.keyv.get(keys as string[]);
      return values.map((value) => {
        if (value == undefined) {
          this.stats.misses++;
          this.recordTypeStats('misses', options.statsType);
          return null;
        }
        this.stats.hits++;
        this.recordTypeStats('hits', options.statsType);
        return value as T[TKey];
      });
    } catch (error) {
      this.logger.error('Error getting multiple cache values:', error);
      this.stats.errors++;
      return keys.map(() => null);
    }
  }

  /**
   * Batch set cache values
   */
  async mset(
    keyValuePairs: Array<{ key: keyof T; value: T[keyof T] }>,
    options: ICacheOptions = {}
  ): Promise<void> {
    if (!this.isAvailable() || options.skipSet) {
      return;
    }

    try {
      const ttlMs = options.ttl ? options.ttl * 1000 : undefined;

      for (const { key, value } of keyValuePairs) {
        await this.setValueToKeyv(key as string, value, ttlMs);
      }

      this.stats.sets += keyValuePairs.length;
    } catch (error) {
      this.logger.error('Error setting multiple cache values:', error);
      this.stats.errors++;
    }
  }

  /**
   * Clear cache keys matching pattern
   * @internal only for testing
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  async _clear() {
    if (!this.isAvailable()) {
      return 0;
    }

    try {
      await this.keyv.clear();
    } catch (error) {
      this.logger.error('Error deleting cache pattern:', error);
      this.stats.errors++;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): ICacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    };
  }

  getTypeStats() {
    return this.typeStats;
  }

  resetTypeStats(): void {
    this.typeStats = {};
  }
  /**
   * Generic cache wrapper method
   * Returns cached value if exists, otherwise executes function and caches result
   * Prevents concurrent execution for the same cache key using Redlock
   */
  async wrap<TResult>(
    key: keyof T,
    fn: () => Promise<TResult>,
    options: ICacheOptions = {}
  ): Promise<TResult> {
    const finalOptions = { preventConcurrent: true, ...options };

    if (!this.isAvailable()) {
      return fn();
    }

    // Try to get from cache first
    const cached = await this.get(key, options);
    if (cached !== null) {
      return cached?.data as TResult;
    }

    // If concurrent prevention is disabled or redlock unavailable, execute directly
    if (!finalOptions.preventConcurrent || !this.isRedlockAvailable()) {
      return this.executeAndCache(key, fn, options);
    }

    // Use redlock for distributed locking
    const cacheKeyStr = key as string;
    const lockResource = `${this.lockPrefix}:${cacheKeyStr}`;
    try {
      // Use redlock.using for automatic lock management
      return await this.redlock!.using([lockResource], 10000, async (signal) => {
        // Check if lock extension failed
        if (signal.aborted) {
          throw signal.error;
        }

        // Check cache again in case another instance already populated it
        const cachedAfterLock = await this.get(key, options);
        if (cachedAfterLock !== null) {
          this.logger.debug(`Cache populated by another instance: ${cacheKeyStr}`);
          return cachedAfterLock?.data as TResult;
        }

        // Check again before executing (in case of long operations)
        if (signal.aborted) {
          throw signal.error;
        }
        // Execute and cache the result
        this.logger.debug(`Executing with distributed lock: ${cacheKeyStr}`);
        return await this.executeAndCache(key, fn, options);
      });
    } catch (error: unknown) {
      if (error instanceof ResourceLockedError || error instanceof ExecutionError) {
        this.logger.error(`Redlock error for ${cacheKeyStr}: ${error}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const cachedAfterLock = await this.get(key, options);
        if (cachedAfterLock !== null) {
          return cachedAfterLock?.data as TResult;
        }
        return this.executeAndCache(key, fn, options);
      }
      this.stats.errors++;
      // Fallback to direct execution
      throw error;
    }
  }

  /**
   * Execute function and cache the result
   */
  private async executeAndCache<TResult>(
    key: keyof T,
    fn: () => Promise<TResult>,
    options: ICacheOptions = {}
  ): Promise<TResult> {
    // Execute the function
    const result = await fn();
    this.logger.log(`Generated cache key: ${key as string}`);
    // Store to cache
    await this.set(key, result as T[keyof T], options);

    return result;
  }
}
