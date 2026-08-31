/* eslint-disable @typescript-eslint/no-explicit-any */
import KeyvRedis from '@keyv/redis';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import Keyv from 'keyv';
import { floor } from 'lodash';
import type { RedlockAbortSignal } from 'redlock';
import Redlock, { ExecutionError, ResourceLockedError } from 'redlock';
import { CacheMetricsService } from './cache-metrics/metrics.service';
import type { ICacheOptions, ICacheStats, IPerformanceCacheStore } from './types';

type ICachedValue<V> = { data: V; gen?: number };

/** Internal plumbing between wrap()/set(): the generation captured before loading. */
type ICacheSetOptions = ICacheOptions & { generation?: number };

// Invariant: must outlive the longest value TTL (currently 24h). If a
// generation key expired while its value was still alive, the generation
// would read as 0 again and a stale gen-0 blob could be served.
const GENERATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class PerformanceCacheService<T extends IPerformanceCacheStore = IPerformanceCacheStore> {
  private readonly logger = new Logger(PerformanceCacheService.name);
  private keyv!: Keyv;
  private redis?: Redis;
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

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly cacheMetricsService?: CacheMetricsService
  ) {
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
      this.redis = store.redis;

      this.keyv.on('error', (error) => {
        this.logger.error(
          `Performance cache connection error: ${error instanceof Error ? error.message : String(error)}`
        );
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

      this.redlock.on('error', (error: Error) => {
        // Check if it's a ResourceLockedError (normal during contention)
        if (error.name === 'ResourceLockedError') {
          this.logger.debug(`Resource locked (normal contention): ${error.message}`);
        } else {
          this.logger.error(
            `Redlock error: ${error instanceof Error ? error.message : String(error)}`
          );
          this.stats.errors++;
        }
      });

      this.logger.log('Performance cache initialized with Redis and Redlock');
    } catch (error) {
      this.logger.error(
        `Failed to initialize performance cache: ${error instanceof Error ? error.message : String(error)}`
      );
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
    type === 'hits'
      ? this.cacheMetricsService?.recordHit(cacheType)
      : this.cacheMetricsService?.recordMiss(cacheType);
    this.cacheMetricsService?.recordHitRate(
      cacheType,
      floor(stats.hits / Math.max(stats.hits + stats.misses, 1), 4) * 100
    );
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

  private generationKey(key: string): string {
    // Raw redis key outside the keyv namespace so it can be INCRed atomically.
    return `perf:gen:${key}`;
  }

  private async readGeneration(key: string): Promise<number> {
    if (!this.redis) {
      return 0;
    }
    const parsed = Number(await this.redis.get(this.generationKey(key)));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async bumpGeneration(key: string): Promise<void> {
    if (!this.redis) {
      return;
    }
    // Atomic INCR keeps concurrent del() bumps from collapsing into one.
    await this.redis
      .multi()
      .incr(this.generationKey(key))
      .pexpire(this.generationKey(key), GENERATION_TTL_MS)
      .exec();
  }

  private setValueToKeyv(
    key: string,
    value: T[keyof T],
    ttlMs: number | undefined,
    generation?: number
  ) {
    const payload: ICachedValue<T[keyof T]> = { data: value, gen: generation ?? 0 };
    return this.keyv.set(key as string, payload, ttlMs);
  }

  /**
   * Get cache value
   */
  async get<TKey extends keyof T>(key: TKey, options: ICacheOptions = {}) {
    if (!this.isAvailable() || options.skipGet) {
      return null;
    }
    return (await this.getWithGeneration(key, options)).cached;
  }

  /**
   * Get the cached value and the current generation together, so wrap() can
   * reuse the generation for the reload instead of reading it again.
   * With skipGet only the value read is skipped: the reload still needs a
   * generation captured before loading.
   */
  private async getWithGeneration<TKey extends keyof T>(
    key: TKey,
    options: ICacheOptions = {}
  ): Promise<{ cached: ICachedValue<T[TKey]> | null; generation: number }> {
    try {
      const startTime = Date.now();
      // Two commands issued in parallel: latency is max, not sum.
      const [value, currentGen] = await Promise.all([
        options.skipGet ? undefined : this.keyv.get(key as string),
        this.readGeneration(key as string),
      ]);
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      if (!options.skipGet && options.statsType) {
        this.cacheMetricsService?.recordGetTime(options.statsType, durationMs);
      }
      if (value == undefined) {
        if (!options.skipGet) {
          this.stats.misses++;
          this.recordTypeStats('misses', options.statsType);
        }
        return { cached: null, generation: currentGen };
      }

      const cached = value as ICachedValue<T[TKey]>;
      if ((cached.gen ?? 0) !== currentGen) {
        // No delete here: a slow reader could race a concurrent set() and
        // remove the fresh value. The stale blob stays invisible to readers
        // and is overwritten by the next set() or expires by TTL.
        this.stats.misses++;
        this.recordTypeStats('misses', options.statsType);
        return { cached: null, generation: currentGen };
      }

      this.stats.hits++;
      this.recordTypeStats('hits', options.statsType);
      return { cached, generation: currentGen };
    } catch (error) {
      this.logger.error('Error getting cache value:', error);
      this.stats.errors++;
      // Generation 0 on error can only under-stamp the reload: the written
      // value becomes invisible, never stale.
      return { cached: null, generation: 0 };
    }
  }

  /**
   * Set cache value
   */
  async set<TKey extends keyof T>(
    key: TKey,
    value: T[TKey],
    options: ICacheSetOptions = {}
  ): Promise<void> {
    if (!this.isAvailable() || options.skipSet) {
      return;
    }

    if (options.ttl == undefined) {
      throw new Error('ttl is required');
    }

    try {
      const ttlMs = options.ttl ? options.ttl * 1000 : undefined;
      const generation = options.generation ?? (await this.readGeneration(key as string));

      await this.setValueToKeyv(key as string, value, ttlMs, generation);
      this.stats.sets++;
    } catch (error) {
      this.logger.error(
        `Error setting cache value: ${error instanceof Error ? error.message : String(error)}`
      );
      this.stats.errors++;
      console.error(error);
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
      await Promise.all([this.keyv.delete(key as string), this.bumpGeneration(key as string)]);
      this.stats.deletes++;
    } catch (error) {
      this.logger.error('Error deleting cache value:', error);
      this.stats.errors++;
    }
  }

  /**
   * Batch get cache values
   *
   * Skips the generation check: do not use on keys invalidated via del()
   * without wiring generations in first.
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
        return (value as ICachedValue<T[TKey]>).data;
      });
    } catch (error) {
      this.logger.error(
        `Error getting multiple cache values: ${error instanceof Error ? error.message : String(error)}`
      );
      this.stats.errors++;
      return keys.map(() => null);
    }
  }

  /**
   * Batch set cache values
   *
   * Stamps generation 0: after any del() of the same key these values are
   * invisible to get()/wrap(); wire generations in before mixing with del().
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
      this.logger.error(
        `Error setting multiple cache values: ${error instanceof Error ? error.message : String(error)}`
      );
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
      this.logger.error(
        `Error deleting cache pattern: ${error instanceof Error ? error.message : String(error)}`
      );
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

    // Try to get from cache first; the same round trip captures the
    // generation to stamp onto a reload.
    const { cached, generation } = await this.getWithGeneration(key, options);
    if (cached !== null) {
      return cached.data as TResult;
    }

    // If concurrent prevention is disabled or redlock unavailable, execute directly
    if (!finalOptions.preventConcurrent || !this.isRedlockAvailable()) {
      return this.executeAndCache(key, fn, { ...options, generation });
    }

    // Use redlock for distributed locking
    const cacheKeyStr = key as string;
    const lockResource = `${this.lockPrefix}:${cacheKeyStr}`;
    try {
      // Use redlock.using for automatic lock management
      return await this.redlock!.using(
        [lockResource],
        10000,
        async (signal: RedlockAbortSignal) => {
          // Check if lock extension failed
          if (signal.aborted) {
            throw signal.error;
          }

          // Check cache again in case another instance already populated it.
          // The generation is re-captured inside the lock so a del() during
          // the wait is not stamped onto a value loaded after invalidation.
          const { cached: cachedAfterLock, generation: lockedGeneration } =
            await this.getWithGeneration(key, options);
          if (cachedAfterLock !== null) {
            this.logger.debug(`Cache populated by another instance: ${cacheKeyStr}`);
            return cachedAfterLock.data as TResult;
          }

          // Check again before executing (in case of long operations)
          if (signal.aborted) {
            throw signal.error;
          }
          this.logger.debug(`Executing with distributed lock: ${cacheKeyStr}`);
          return await this.executeAndCache(key, fn, {
            ...options,
            generation: lockedGeneration,
          });
        }
      );
    } catch (error: unknown) {
      if (error instanceof ResourceLockedError || error instanceof ExecutionError) {
        this.logger.error(`Redlock error for ${cacheKeyStr}: ${error}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const { cached: cachedAfterLock, generation: retryGeneration } =
          await this.getWithGeneration(key, options);
        if (cachedAfterLock !== null) {
          return cachedAfterLock.data as TResult;
        }
        return this.executeAndCache(key, fn, { ...options, generation: retryGeneration });
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
    options: ICacheSetOptions = {}
  ): Promise<TResult> {
    // Execute the function
    const result = await fn();
    this.logger.log(`Generated cache key: ${key as string}`);
    // Store to cache
    await this.set(key, result as T[keyof T], options);

    return result;
  }
}
