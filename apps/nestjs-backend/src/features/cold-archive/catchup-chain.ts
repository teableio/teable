import type { Job, Queue } from 'bullmq';

/**
 * Backlog drain shared by the cold flush processors: chain one catch-up run
 * instead of a marathon, bounded per scheduled run.
 *
 * The jobId carries the hop number because BullMQ dedups custom ids against
 * ANY existing job — including the one executing — and pending/active chains
 * are checked before adding, so a daily run can never spawn a second chain.
 * BullMQ also rejects ':' in custom ids, hence the colon-free prefix.
 *
 * Once the hop budget is spent the backlog simply stays in the buffer: the
 * next scheduled run resumes past the persisted prefix, which is what spreads
 * a first backfill over days without any operator action. In steady state a
 * day's rows are far below the row budget, so this never fires at all.
 */
export const chainCatchupFlush = async (options: {
  job: Job;
  queue: Queue;
  flushJobId: string;
  /** colon-free (BullMQ custom-id restriction) */
  catchupJobIdPrefix: string;
  delayMs: number;
  /** chained runs allowed per SCHEDULED run; 0 chains until drained */
  maxHops: number;
  logger: { log: (message: string) => void; warn: (message: string) => void };
}): Promise<void> => {
  const { job, queue, flushJobId, catchupJobIdPrefix, delayMs, maxHops, logger } = options;
  try {
    // the redis-less fallback queue has no job introspection
    const introspectable = queue as Queue & {
      getJobs?: (types: string[]) => Promise<({ id?: string } | undefined)[]>;
    };
    if (typeof introspectable.getJobs === 'function') {
      const existing = (await introspectable.getJobs(['delayed', 'waiting', 'active'])).filter(
        (other) => other?.id?.startsWith(catchupJobIdPrefix) && other.id !== job.id
      );
      if (existing.length > 0) {
        logger.log('catch-up flush already chained; not starting a second chain');
        return;
      }
    }
    const hop = ((job.data as { catchupHop?: number } | undefined)?.catchupHop ?? 0) + 1;
    if (maxHops > 0 && hop > maxHops) {
      logger.log(
        `catch-up hop budget reached (${maxHops}); the remaining backlog resumes on the next scheduled run`
      );
      return;
    }
    await queue.add(
      flushJobId,
      { catchupHop: hop },
      {
        // budgetExhausted implies a full row/byte budget of progress, so the
        // chain can never hot-loop without work
        delay: delayMs,
        jobId: `${catchupJobIdPrefix}-${hop}`,
        removeOnComplete: true,
        removeOnFail: true,
      }
    );
  } catch (error) {
    logger.warn(`failed to chain catch-up flush: ${error}`);
  }
};
