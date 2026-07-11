import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { RecordHistoryColdStorageService } from './record-history-cold-storage.service';
import { recordHistoryColdConfig } from './record-history-cold.config';
import type { ICompactMonthResult } from './record-history-compactor.service';
import { RecordHistoryCompactorService } from './record-history-compactor.service';
import type { IColdFlushRunResult } from './record-history-flusher.service';
import { RecordHistoryFlusherService } from './record-history-flusher.service';

export const RECORD_HISTORY_COLD_QUEUE = 'record-history-cold-queue';

const FLUSH_JOB_ID = 'record-history-cold:flush';
const FLUSH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const COMPACT_JOB_ID = 'record-history-cold:compact';
/** 04:10 UTC on the 2nd of each month: every closed month has fully flushed */
const COMPACT_CRON = '10 4 2 * *';
// BullMQ accepts ':' in scheduler ids and job NAMES (both proven in prod) but
// rejects it in CUSTOM job ids ("Custom Id cannot contain :"), so every id
// passed to queue.add() below must stay colon-free
const CATCHUP_JOB_ID_PREFIX = 'record-history-cold-flush-catchup';

/**
 * Daily incremental flush plus monthly compaction of the record_history
 * write buffer / cold parts. Both schedulers are env-gated so only
 * deployments that opted in run them.
 */
@Injectable()
@Processor(RECORD_HISTORY_COLD_QUEUE)
export class RecordHistoryColdProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordHistoryColdProcessor.name);

  constructor(
    private readonly flusher: RecordHistoryFlusherService,
    private readonly compactor: RecordHistoryCompactorService,
    private readonly coldStorage: RecordHistoryColdStorageService,
    @InjectQueue(RECORD_HISTORY_COLD_QUEUE) private readonly queue: Queue
  ) {
    super();
  }

  async onApplicationBootstrap() {
    const config = recordHistoryColdConfig();
    if (!config.flushSchedulerEnabled && !config.compactSchedulerEnabled) {
      // kill-switched process: consume nothing (a paused worker on a shared
      // redis leaves the jobs to any still-enabled pods)
      if (typeof this.worker?.pause === 'function') {
        await this.worker.pause(true);
        this.logger.log('record-history cold worker paused (cold feature disabled here)');
      }
      // deliberately NO scheduler removal here: no process can tell "the
      // feature was disabled everywhere" from "other pods still run it",
      // and removing from the shared redis would tear down their schedule.
      // With a fleet-wide kill switch the schedulers' jobs are skipped at
      // execution by process() and sit as at most a couple of delayed jobs
      // per day until re-enable (or a manual scheduler cleanup).
      return;
    }
    // the redis-less fallback queue has no job schedulers; skip silently there
    if (typeof this.queue.upsertJobScheduler !== 'function') {
      this.logger.warn('record-history cold schedulers unavailable without redis');
      return;
    }
    // schedulers are only ever ADDED here, never removed: no process can
    // tell a fleet-wide rollback from "that scheduler belongs to another
    // pod" (API pods, or flush/compact split across worker pods), and a
    // removal on restart would silently tear down a peer's schedule. A
    // rolled-back flag is neutralized by the execution-time gate in
    // process(); clearing the leftover scheduler entry is a manual op.
    try {
      if (config.flushSchedulerEnabled) {
        // creating the scheduler fires its first run immediately (that is
        // what starts the migration on a fresh install); on upgrade deploys
        // the next slot is at most a day away. Deliberately NO boot-time
        // kick beyond that: a fixed-id kick job needs a fleet-wide dedupe
        // marker, and BullMQ's lazy retention pruning turns that marker
        // into a footgun (see the 2026-07-08 stalls). If a backlog must
        // drain sooner than the next daily slot, run the EE cold runner
        // once (flush --max-rows=0) — a deliberate op, not boot magic.
        await this.queue.upsertJobScheduler(
          FLUSH_JOB_ID,
          { every: FLUSH_INTERVAL_MS },
          { name: FLUSH_JOB_ID }
        );
        this.logger.log(`record-history cold flush scheduled (every ${FLUSH_INTERVAL_MS / 1000}s)`);
      }
      if (config.compactSchedulerEnabled) {
        await this.queue.upsertJobScheduler(
          COMPACT_JOB_ID,
          { pattern: COMPACT_CRON },
          { name: COMPACT_JOB_ID }
        );
        this.logger.log(`record-history cold compaction scheduled (cron ${COMPACT_CRON})`);
      }
    } catch (error) {
      this.logger.error('failed to register record-history cold schedulers', error);
    }
  }

  async process(job: Job): Promise<IColdFlushRunResult | ICompactMonthResult[] | undefined> {
    // execution gate: an enabled process executes WHATEVER cold job it
    // receives (per-name gating would let a pod "complete" a peer's job
    // without running it); a kill-switched process skips everything, so a
    // stale scheduler or an already-enqueued job cannot outlive a fleet-wide
    // disable
    const config = recordHistoryColdConfig();
    if (!config.flushSchedulerEnabled && !config.compactSchedulerEnabled) {
      this.logger.warn('skipping cold maintenance job: this process has no cold scheduler flags');
      return undefined;
    }
    if (job.name === COMPACT_JOB_ID) {
      return this.runCompaction();
    }
    // monthly safety sweep: on the 1st the daily run ignores the BYODB
    // bookmarks, so a space whose activity signal was ever missed (however
    // that might happen) is stranded for at most a month instead of forever
    const result = await this.flusher.runFlush({
      mode: 'incremental',
      ignoreBookmarks: new Date().getUTCDate() === 1,
    });
    this.logger.log(
      `record-history cold flush: tables=${result.tables.length} rows=${result.totalRows} ` +
        `parts=${result.totalParts} bytes=${result.totalCompressedBytes} in ${result.durationMs}ms` +
        (result.totalTruncatedValues ? ` truncated=${result.totalTruncatedValues}` : '') +
        (result.leftoverTables ? ` (deferred ${result.leftoverTables} table(s))` : '')
    );
    if (result.budgetExhausted) {
      await this.chainCatchupFlush(job);
    }
    return result;
  }

  /**
   * backlog drain (e.g. right after an upgrade): chain a catch-up run
   * instead of one marathon. The jobId carries the hop number because BullMQ
   * dedups an .add() whose id matches ANY existing job INCLUDING the one
   * currently executing — a fixed id would end the chain at hop one. Unique
   * ids alone would let a daily run spawn a second chain next to a live one
   * (its hop numbering restarts), so before adding we check the queue for
   * any other pending/active catch-up and skip if one exists.
   */
  private async chainCatchupFlush(job: Job): Promise<void> {
    try {
      const queue = this.queue as Queue & {
        getJobs?: (types: string[]) => Promise<({ id?: string } | undefined)[]>;
      };
      if (typeof queue.getJobs === 'function') {
        const existing = (await queue.getJobs(['delayed', 'waiting', 'active'])).filter(
          (other) => other?.id?.startsWith(CATCHUP_JOB_ID_PREFIX) && other.id !== job.id
        );
        if (existing.length > 0) {
          this.logger.log('catch-up flush already chained; not starting a second chain');
          return;
        }
      }
      const hop = ((job.data as { catchupHop?: number } | undefined)?.catchupHop ?? 0) + 1;
      await this.queue.add(
        FLUSH_JOB_ID,
        { catchupHop: hop },
        {
          // near-immediate: the budget bounds each run's blast radius, so
          // there is nothing to gain by idling between hops — the backlog
          // drains continuously, one budget-sized, crash-safe run at a time.
          // budgetExhausted implies >= maxRows of progress, so the chain can
          // never hot-loop without work.
          delay: recordHistoryColdConfig().catchupDelayMs,
          jobId: `${CATCHUP_JOB_ID_PREFIX}-${hop}`,
          removeOnComplete: true,
          removeOnFail: true,
        }
      );
    } catch (error) {
      this.logger.warn(`failed to chain catch-up flush: ${error}`);
    }
  }

  /** compact every cold table's closed months (day parts → month parts) */
  private async runCompaction(): Promise<ICompactMonthResult[]> {
    const tables = await this.coldStorage.listTables();
    const results: ICompactMonthResult[] = [];
    for (const tableId of tables) {
      try {
        results.push(...(await this.compactor.compactTable(tableId)));
      } catch (error) {
        this.logger.error(
          `record-history compaction failed for ${tableId}: ${error instanceof Error ? error.stack : error}`
        );
      }
    }
    const merged = results.filter((result) => !result.skippedReason);
    this.logger.log(
      `record-history cold compaction: tables=${tables.length} monthsMerged=${merged.length} ` +
        `rows=${merged.reduce((sum, item) => sum + item.rows, 0)}`
    );
    return results;
  }
}
