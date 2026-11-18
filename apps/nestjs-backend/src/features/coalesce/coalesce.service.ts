import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import ms from 'ms';
import { CacheService } from '../../cache/cache.service';
import type { ICacheStore } from '../../cache/types';
import { DistributedLockService } from '../../distributed-lock';

export const COALESCE_QUEUE = 'coalesce-queue';
const COALESCE_FLUSH_JOB = 'coalesce-flush';

export enum CoalesceMode {
  /** The window runs a fixed time from the item that opened it. */
  Fixed = 'fixed',
  /** Every item pushes the window out again: it closes once items stop for that long. */
  Quiet = 'quiet',
}

export interface ICoalescePolicy {
  mode: CoalesceMode;
  windowMs: number;
}

export interface ICoalesceFlushJob {
  scope: string;
  key: string;
}

/** Sends the items buffered behind one key's window, as one. Throwing keeps them for a retry. */
export type ICoalesceFlush<T> = (key: string, items: T[]) => Promise<void>;

/** Folds a key's buffer as items join it, so a long batch is stored at the size it is sent. */
export type ICoalesceReduce<T> = (items: T[]) => T[];

// Buffered items outlive their window by this much, enough for the flush and its retries.
const PENDING_GRACE_MS = ms('1h');

// A closed window's entry is kept this long, past the flush's retries: while it lasts, the
// batch behind it has a flush on its way, so items that join it book no other. The flush's
// last failed attempt removes it sooner, so the next item books the batch a new flush.
const FLUSH_GRACE_MS = ms('10m');

// Per scope and key: when its window closes, and the items buffered behind it
const windowKey = (id: string) => `coalesce:window:${id}` as const;
const pendingKey = (id: string) => `coalesce:pending:${id}` as const;

// The entry outlives the time it closes at: past it, the window is shut
const openUntil = (closesAt: number | undefined, now: number) =>
  closesAt && closesAt > now ? closesAt : undefined;

/**
 * Coalesces what arrives for one key: an item with no open window goes out at once and opens
 * one, the rest buffer behind it and go to the scope's flush, as one, once the window closes.
 * The window and the buffer live in the shared cache under one lock per key, so every pod
 * coalesces into the same batch, and the flush is a queued job rather than a pod's timer, so
 * a batch outlives the pod that filled it.
 */
@Injectable()
export class CoalesceService {
  private readonly flushes = new Map<string, ICoalesceFlush<unknown>>();
  private readonly reducers = new Map<string, ICoalesceReduce<unknown>>();

  constructor(
    private readonly cacheService: CacheService<ICacheStore>,
    private readonly distributedLockService: DistributedLockService,
    @InjectQueue(COALESCE_QUEUE) private readonly queue: Queue<ICoalesceFlushJob>
  ) {}

  /** Registered by the scope's owner: what its buffered items become once a window closes. */
  onFlush<T>(scope: string, flush: ICoalesceFlush<T>, reduce?: ICoalesceReduce<T>) {
    this.flushes.set(scope, flush as ICoalesceFlush<unknown>);
    if (reduce) {
      this.reducers.set(scope, reduce as ICoalesceReduce<unknown>);
    }
  }

  /**
   * Whether the item opened the window, in which case the caller sends it now. Otherwise it is
   * buffered for the scope's flush.
   */
  async add<T>(scope: string, key: string, item: T, policy: ICoalescePolicy): Promise<boolean> {
    const id = `${scope}:${key}`;
    return this.withLock(id, async () => {
      const now = Date.now();
      const [stored, pending] = (await this.cacheService.getMany([
        windowKey(id),
        pendingKey(id),
      ])) as [number | undefined, unknown[] | undefined];
      const closesAt = openUntil(stored, now);
      if (!closesAt && !pending) {
        await this.setWindow(id, now + policy.windowMs, now);
        return true;
      }
      // A closed window with items still buffered is a batch on its way out: a fixed window
      // sends this one with it, a quiet one waits for the writes to stop again.
      const nextClosesAt =
        policy.mode === CoalesceMode.Quiet ? now + policy.windowMs : (closesAt ?? now);
      // A new batch gets its flush; so does one whose flush is past its retries without having
      // sent it. Booked before the item is buffered: a booking that fails throws for this item
      // alone, rather than leaving a batch that later items join without a flush.
      const book = !pending || !stored;
      if (book) {
        await this.bookFlush({ scope, key }, nextClosesAt - now);
      }
      const items = [...(pending ?? []), item];
      const reduce = this.reducers.get(scope);
      await this.cacheService.setDetail(
        pendingKey(id),
        reduce ? reduce(items) : items,
        (nextClosesAt - now + PENDING_GRACE_MS) / 1000
      );
      // The entry also marks the batch's flush as booked, closed or not
      if (book || (nextClosesAt !== closesAt && nextClosesAt > now)) {
        await this.setWindow(id, nextClosesAt, now);
      }
      return false;
    });
  }

  /**
   * Run by the queue: a window still open books the flush again for when it closes. After the
   * last attempt fails, the batch is left with no flush, for the next item to book.
   */
  async flush({ scope, key }: ICoalesceFlushJob, lastAttempt: boolean): Promise<void> {
    const flush = this.flushes.get(scope);
    if (!flush) {
      throw new Error(`No coalesce flush registered for scope ${scope}`);
    }
    const id = `${scope}:${key}`;
    await this.withLock(id, async () => {
      const now = Date.now();
      const closesAt = openUntil(await this.cacheService.get(windowKey(id)), now);
      if (closesAt) {
        await this.bookFlush({ scope, key }, closesAt - now);
        return;
      }
      const items = await this.cacheService.get(pendingKey(id));
      if (!items?.length) {
        return;
      }
      // Cleared only once sent, so a failed flush is retried rather than lost.
      try {
        await flush(key, items);
      } catch (error) {
        if (lastAttempt) {
          await this.cacheService.del(windowKey(id));
        }
        throw error;
      }
      await this.cacheService.del(pendingKey(id));
    });
  }

  private async setWindow(id: string, closesAt: number, now: number) {
    await this.cacheService.setDetail(
      windowKey(id),
      closesAt,
      (closesAt - now + FLUSH_GRACE_MS) / 1000
    );
  }

  private async bookFlush(job: ICoalesceFlushJob, delayMs: number) {
    await this.queue.add(COALESCE_FLUSH_JOB, job, {
      delay: Math.max(0, delayMs),
      attempts: 3,
      backoff: { type: 'exponential', delay: ms('1m') },
    });
  }

  private async withLock<T>(id: string, task: () => Promise<T>): Promise<T> {
    let result!: T;
    while (
      !(await this.distributedLockService.runExclusive(`coalesce:${id}`, 30, async () => {
        result = await task();
      }))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return result;
  }
}
