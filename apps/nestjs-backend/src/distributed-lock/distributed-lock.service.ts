import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../cache/cache.service';
import type { ICacheConfig } from '../configs/cache.config';

/**
 * Best-effort distributed lock backed by Redis (`SET NX`).
 *
 * Lets a caller run a critical section on exactly one instance across a
 * multi-pod deployment. Without Redis there is no shared store, so the lock
 * degrades to a no-op and every instance proceeds — callers must therefore
 * keep the guarded work idempotent.
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  /** Unique per process — identifies the locks this instance owns. */
  private readonly owner = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  constructor(
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Run `task` while holding the lock named `name`, so only one instance runs
   * it at a time. If another instance holds the lock, `task` is skipped. The
   * lock is released afterwards and also auto-expires after `ttlSeconds`.
   *
   * @returns `true` if `task` ran, `false` if it was skipped.
   */
  async runExclusive(
    name: string,
    ttlSeconds: number,
    task: () => Promise<void>
  ): Promise<boolean> {
    const key = `lock:${name}` as const;

    if (!(await this.acquire(key, ttlSeconds))) {
      this.logger.debug(`Lock "${name}" held by another instance, skipping`);
      return false;
    }

    try {
      await task();
    } finally {
      await this.release(key);
    }
    return true;
  }

  private get usesRedis(): boolean {
    return this.configService.get<ICacheConfig>('cache')?.provider === 'redis';
  }

  private async acquire(key: `lock:${string}`, ttlSeconds: number): Promise<boolean> {
    // No Redis — no shared store to lock against; let the caller proceed.
    if (!this.usesRedis) {
      return true;
    }
    try {
      return await this.cacheService.setnx(key, this.owner, ttlSeconds);
    } catch (error) {
      this.logger.warn(`Failed to acquire lock "${key}", proceeding anyway`, error);
      return true;
    }
  }

  private async release(key: `lock:${string}`): Promise<void> {
    if (!this.usesRedis) {
      return;
    }
    try {
      // Only release a lock this instance still owns.
      if ((await this.cacheService.get(key)) === this.owner) {
        await this.cacheService.del(key);
      }
    } catch (error) {
      this.logger.warn(`Failed to release lock "${key}"`, error);
    }
  }
}
