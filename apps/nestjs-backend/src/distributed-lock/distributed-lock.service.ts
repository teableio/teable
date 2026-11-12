import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

/**
 * Best-effort distributed lock backed by Redis (`SET NX`).
 *
 * Lets a caller run a critical section on exactly one instance across a
 * multi-pod deployment. When Redis errors the lock is skipped and the caller
 * proceeds, so callers must keep the guarded work idempotent.
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  /** Unique per process — identifies the locks this instance owns. */
  private readonly owner = `${process.pid}-${randomUUID()}`;

  constructor(private readonly cacheService: CacheService) {}

  /**
   * Run `task` while holding the lock named `name`, so only one instance runs
   * it at a time. If another instance holds the lock, `task` is skipped. The
   * lock is renewed while `task` runs and released afterwards; an instance
   * that dies holding it loses it within `ttlSeconds`.
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

    const renewal = setInterval(() => void this.renew(key, ttlSeconds), (ttlSeconds * 1000) / 3);
    try {
      await task();
    } finally {
      clearInterval(renewal);
      await this.release(key);
    }
    return true;
  }

  private async acquire(key: `lock:${string}`, ttlSeconds: number): Promise<boolean> {
    try {
      return await this.cacheService.setnx(key, this.owner, ttlSeconds);
    } catch (error) {
      this.logger.warn(`Failed to acquire lock "${key}", proceeding anyway`, error);
      return true;
    }
  }

  private async renew(key: `lock:${string}`, ttlSeconds: number): Promise<void> {
    try {
      await this.cacheService.renewLock(key, this.owner, ttlSeconds);
    } catch (error) {
      this.logger.warn(`Failed to renew lock "${key}"`, error);
    }
  }

  private async release(key: `lock:${string}`): Promise<void> {
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
