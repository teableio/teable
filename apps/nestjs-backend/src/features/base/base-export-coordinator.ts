import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import type { ExportBaseProgressCallback, IExportBaseVo } from '@teable/openapi';
import type { CacheService } from '../../cache/cache.service';
import { CustomHttpException } from '../../custom.exception';
import { isBaseExportCancelled } from './base-export-stream';

interface IExportOptions {
  baseId: string;
  includeData: boolean;
  userId: string;
  onProgress?: ExportBaseProgressCallback;
  signal?: AbortSignal;
  onCancelled?: () => Promise<void>;
}

type ExportWork = (
  signal: AbortSignal,
  onProgress: ExportBaseProgressCallback,
  commitTerminalOutcome: () => boolean
) => Promise<IExportBaseVo | undefined>;

interface ISubscriber {
  onProgress?: ExportBaseProgressCallback;
  resolve: (result: IExportBaseVo | undefined) => void;
  reject: (error: unknown) => void;
  removeAbortListener: () => void;
}

interface IExportJob {
  key: string;
  leaseKey: `lock:base-export:${string}`;
  token: string;
  controller: AbortController;
  subscribers: Set<ISubscriber>;
  terminalCommitted: boolean;
  accepting: boolean;
  lastProgress?: Parameters<ExportBaseProgressCallback>;
  onCancelled?: () => Promise<void>;
}

const LEASE_TTL_SECONDS = 60;
const RENEW_INTERVAL_MS = 20_000;

// Node 22 provides this API; this package's ES2022 TypeScript library predates it.
const promiseWithResolvers = Promise as unknown as {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

/**
 * One distinct export per process; only the initiating user's identical requests share a result.
 * Genuine Keyv Map stores use only local admission; all other stores require the Redis lease.
 * Late subscribers immediately receive the most recent progress event.
 * Progress callback errors reject that subscriber, leaving other subscribers running. When the
 * final subscriber leaves (including a callback failure), work is aborted but keeps its slot
 * until its cleanup and owner-only lease release have settled.
 * Distributed work is aborted when its last confirmed lease expires, even if renewal stalls.
 */
export class BaseExportCoordinator {
  private readonly logger = new Logger(BaseExportCoordinator.name);
  private active?: IExportJob;

  constructor(private readonly cacheService: CacheService) {}

  run(options: IExportOptions, work: ExportWork): Promise<IExportBaseVo | undefined> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason);
    }

    const key = JSON.stringify([options.baseId, options.includeData, options.userId]);
    if (this.active) {
      if (this.active.key !== key || !this.active.accepting) {
        return Promise.reject(
          new CustomHttpException(
            'A base export is already running. Try again later.',
            HttpErrorCode.TOO_MANY_REQUESTS,
            { domainCode: 'base.export_busy' }
          )
        );
      }
      return this.subscribe(this.active, options);
    }

    const job: IExportJob = {
      key,
      leaseKey: `lock:base-export:${options.baseId}`,
      token: randomUUID(),
      controller: new AbortController(),
      subscribers: new Set(),
      accepting: true,
      terminalCommitted: false,
      onCancelled: options.onCancelled,
    };
    // Reserve synchronously, before the asynchronous distributed lease acquisition.
    this.active = job;
    const result = this.subscribe(job, options);
    // Both handlers observe the underlying task even after every subscriber has left.
    void this.execute(job, work).then(
      (value) => this.settle(job, (subscriber) => subscriber.resolve(value)),
      (error: unknown) => this.settle(job, (subscriber) => subscriber.reject(error))
    );
    return result;
  }

  private subscribe(job: IExportJob, options: IExportOptions) {
    const { promise, resolve, reject } = promiseWithResolvers.withResolvers<
      IExportBaseVo | undefined
    >();
    const onAbort = () => this.removeSubscriber(job, subscriber, options.signal?.reason);
    const subscriber: ISubscriber = {
      resolve,
      reject,
      onProgress: options.onProgress,
      removeAbortListener: () => options.signal?.removeEventListener('abort', onAbort),
    };
    job.subscribers.add(subscriber);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    if (job.lastProgress && job.subscribers.has(subscriber)) {
      try {
        subscriber.onProgress?.(...job.lastProgress);
      } catch (error) {
        this.removeSubscriber(job, subscriber, error);
      }
    }
    return promise;
  }

  private removeSubscriber(job: IExportJob, subscriber: ISubscriber, error: unknown) {
    if (!job.subscribers.delete(subscriber)) return;
    subscriber.removeAbortListener();
    subscriber.reject(error);
    if (!job.subscribers.size) {
      job.accepting = false;
      if (!job.terminalCommitted) job.controller.abort(error);
    }
  }

  private settle(job: IExportJob, settleSubscriber: (subscriber: ISubscriber) => void) {
    job.accepting = false;
    for (const subscriber of job.subscribers) {
      subscriber.removeAbortListener();
      settleSubscriber(subscriber);
    }
    job.subscribers.clear();
  }

  private async execute(job: IExportJob, work: ExportWork) {
    let acquired = false;
    let localOnly = false;
    let finishing = false;
    let renewal: Promise<void> | undefined;
    let interval: NodeJS.Timeout | undefined;
    let expiryTimeout: NodeJS.Timeout | undefined;
    let confirmedDeadline = 0;
    const { signal } = job.controller;
    const clearLeaseTimers = () => {
      clearInterval(interval);
      clearTimeout(expiryTimeout);
    };
    const watchLeaseDeadline = () => {
      clearTimeout(expiryTimeout);
      if (job.terminalCommitted) return;
      const remaining = confirmedDeadline - performance.now();
      if (remaining <= 0) {
        this.abortForLeaseFailure(job);
        return;
      }
      expiryTimeout = setTimeout(watchLeaseDeadline, Math.ceil(remaining));
      expiryTimeout.unref();
    };
    const confirmLease = (requestStartedAt: number) => {
      if (finishing || signal.aborted) return;
      // Redis applies the TTL before replying; response latency cannot extend safe ownership.
      confirmedDeadline = requestStartedAt + LEASE_TTL_SECONDS * 1000;
      if (!job.terminalCommitted) watchLeaseDeadline();
    };
    const renewLease = async () => {
      try {
        const requestStartedAt = performance.now();
        const renewed = await this.cacheService.renewLock(
          job.leaseKey,
          job.token,
          LEASE_TTL_SECONDS
        );
        if (finishing || signal.aborted) return;
        if (!renewed || (!job.terminalCommitted && performance.now() >= confirmedDeadline)) {
          this.abortForLeaseFailure(job);
          return;
        }
        confirmLease(requestStartedAt);
      } catch {
        if (!finishing && !job.terminalCommitted && !signal.aborted) this.abortForLeaseFailure(job);
      }
    };

    try {
      signal.throwIfAborted();
      try {
        // Only a genuine in-memory Keyv store opts out of the distributed lease.
        // A Redis adapter remains an adapter during outages, so its errors stay fatal.
        localOnly = this.cacheService.getKeyv().opts.store instanceof Map;
        if (!localOnly) {
          signal.addEventListener('abort', clearLeaseTimers, { once: true });
          const requestStartedAt = performance.now();
          acquired = await this.cacheService.setnx(job.leaseKey, job.token, LEASE_TTL_SECONDS);
          if (acquired) confirmLease(requestStartedAt);
        }
      } catch {
        throw new HttpException(
          'The base export lease is unavailable. Try again later.',
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }
      signal.throwIfAborted();
      if (!localOnly && !acquired) {
        throw new CustomHttpException(
          'A base export is already running. Try again later.',
          HttpErrorCode.TOO_MANY_REQUESTS,
          { domainCode: 'base.export_busy' }
        );
      }

      if (!localOnly) {
        interval = setInterval(() => {
          if (!job.terminalCommitted && performance.now() >= confirmedDeadline) {
            this.abortForLeaseFailure(job);
            return;
          }
          if (renewal || signal.aborted) return;
          renewal = renewLease().finally(() => {
            renewal = undefined;
          });
        }, RENEW_INTERVAL_MS);
        interval.unref();
      }
      signal.throwIfAborted();
      const result = await work(
        signal,
        (...progress) => {
          if (signal.aborted || finishing) return;
          job.lastProgress = progress;
          // Snapshot so a callback cannot extend this event's iteration by adding subscribers.
          for (const subscriber of [...job.subscribers]) {
            if (!job.subscribers.has(subscriber)) continue;
            try {
              subscriber.onProgress?.(...progress);
            } catch (error) {
              this.removeSubscriber(job, subscriber, error);
            }
          }
        },
        () => {
          // Commit synchronously before terminal publication; delivery still owns this slot.
          if (job.terminalCommitted) return false;
          job.terminalCommitted = true;
          // Renew healthy ownership until real work unwinds, without reclassifying publication.
          clearTimeout(expiryTimeout);
          return true;
        }
      );
      if (!job.terminalCommitted) signal.throwIfAborted();
      return result;
    } finally {
      const cancelled = !job.terminalCommitted && isBaseExportCancelled(signal);
      finishing = true;
      job.accepting = false;
      clearLeaseTimers();
      signal.removeEventListener('abort', clearLeaseTimers);
      // Settle in-flight lease operations before owner-only release and local capacity reuse.
      await renewal;
      try {
        if (acquired) await this.cacheService.releaseLock(job.leaseKey, job.token);
      } catch (error) {
        this.logger.warn('Failed to release the base export lease', error);
      } finally {
        try {
          if (cancelled) await job.onCancelled?.();
        } finally {
          if (this.active === job) this.active = undefined;
        }
      }
    }
  }

  private abortForLeaseFailure(job: IExportJob) {
    if (job.terminalCommitted) return;
    const error = new HttpException(
      'The base export lease is unavailable. Try again later.',
      HttpStatus.SERVICE_UNAVAILABLE
    );
    job.controller.abort(error);
    this.settle(job, (subscriber) => subscriber.reject(error));
  }
}
