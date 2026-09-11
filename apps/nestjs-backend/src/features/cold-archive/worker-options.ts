import type { WorkerOptions } from 'bullmq';
import ms from 'ms';

/**
 * Worker options shared by the cold-archive processors. Their jobs run for
 * hours and merge gzip parts on the event loop, so the lock outlives a busy
 * stretch instead of stalling a live job; a pod reclaimed mid-run still hands
 * the job over within a lock period, and it may hand over more than once.
 */
export const COLD_WORKER_OPTIONS: Pick<
  WorkerOptions,
  'lockDuration' | 'lockRenewTime' | 'stalledInterval' | 'maxStalledCount'
> = {
  lockDuration: ms('5m'),
  lockRenewTime: ms('1m'),
  stalledInterval: ms('30s'),
  maxStalledCount: 3,
};
