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

  private async acquire(key: `lock:${string}`, ttlSeconds: number): Promise<boolean> {
    try {
      return await this.cacheService.setnx(key, this.owner, ttlSeconds);
    } catch (error) {
      this.logger.warn(`Failed to acquire lock "${key}", proceeding anyway`, error);
      return true;
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
