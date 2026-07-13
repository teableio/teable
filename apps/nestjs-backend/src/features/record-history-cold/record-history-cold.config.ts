const readBoolEnv = (name: string): boolean => {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
};

const readPositiveIntEnv = (name: string, defaultValue: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultValue;
};

/** like readPositiveIntEnv but 0 is a valid value (used for "disabled") */
const readNonNegativeIntEnv = (name: string, defaultValue: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : defaultValue;
};

export interface IRecordHistoryColdConfig {
  /** daily BullMQ flush scheduler (on unless disabled) */
  flushSchedulerEnabled: boolean;
  /** monthly BullMQ compaction scheduler (on unless disabled) */
  compactSchedulerEnabled: boolean;
  /** delete flushed rows from the PG buffer (on unless disabled) */
  deleteEnabled: boolean;
  /** rows older than this are flushed (default 24h) */
  flushHorizonMs: number;
  /** rows younger than this go to day files during backfill (default 30d) */
  backfillDayWindowMs: number;
  /** cut part at this many uncompressed bytes (default 32MB ≈ 4-8MB compressed) */
  partUncompressedBytes: number;
  /** concurrent tables per flush run */
  tableConcurrency: number;
  /**
   * soft row budget per flush run (checked between tables): a fresh upgrade
   * with years of backlog drains gradually across chained runs instead of
   * one marathon inside the app process; 0 disables the budget
   */
  maxRowsPerRun: number;
  /**
   * pause between chained catch-up runs. The budget bounds each RUN's blast
   * radius (memory, transaction size, job-slot occupancy) — waiting between
   * hops adds nothing, so the default is a token breather; each hop is its
   * own queue job and lands on whatever worker is free
   */
  catchupDelayMs: number;
  /** keyset batch size for buffer reads (upper bound; adapts down by bytes) */
  readBatchSize: number;
  /**
   * shared in-memory cap (approximate serialized bytes) for ALL sort runs of
   * one flush or compaction run. Record-major buffer reads keep every bucket
   * sorter of a table alive at once, so the bound must be global — a
   * per-sorter cap alone multiplies by bucket count (the 2026-07-08 cn drain
   * OOM). JS heap cost is ~2-3x this figure.
   */
  sortMemoryBudgetBytes: number;
  /**
   * max run files a merge opens at once (multi-pass above this). Each open
   * reader holds one decoded row plus its line buffer, and a history row can
   * be tens of MB, so an unbounded fan-in over a big bucket's runs OOMs. Lower
   * on tiny-heap deployments (effective minimum is 2 — a merge must combine
   * at least two runs per pass or it never converges).
   */
  sortMergeFanIn: number;
  /**
   * a before/after JSON longer than this (UTF-16 units) is replaced with a
   * marker before it enters the sort pipeline — only the pre-cap anomalies
   * (multi-MB legacy rows) that OOM the flush. The threshold applies to the
   * whole {meta,data} history envelope, so it must sit ABOVE a valid cell's
   * envelope: a cell value caps at TABLE_LIMIT_CELL_VALUE_MAX_BYTES (256KB) of
   * data, whose envelope stays well under the 1MB default, so no legitimate
   * max-size value is ever truncated. 0 disables.
   */
  truncateValueUnits: number;
  /** overall budget for the S3 segment of a history read */
  s3ReadTimeoutMs: number;
  /** buffer rows older than this raise the flush-lag alarm (default 72h) */
  bufferLagAlarmMs: number;
}

/**
 * The feature ships ON by default and migrates transparently: the daily
 * flush moves history older than the horizon to cold parts, deletes the
 * covered buffer rows, and getRecordHistory merges both sources — no
 * operator action, no data movement step, backlog drains itself under the
 * per-run row budget.
 *
 * BACKEND_RECORD_HISTORY_COLD_DISABLED=true is the single kill switch and
 * it stops the MIGRATION PROCESS only (flush scheduler, compaction,
 * deletion). Merged reads are unconditional — reading is not part of the
 * migration, it is how migrated data stays visible — so a switched-off
 * process (a staging environment sharing the production database, or a
 * rolled-back fleet) still serves full history from buffer + bucket. An
 * environment that shares its database with another one should keep the
 * switch ON permanently and let exactly one environment own the migration.
 */
export const recordHistoryColdConfig = (): IRecordHistoryColdConfig => {
  const disabled = readBoolEnv('BACKEND_RECORD_HISTORY_COLD_DISABLED');
  return {
    flushSchedulerEnabled: !disabled,
    compactSchedulerEnabled: !disabled,
    deleteEnabled: !disabled,
    flushHorizonMs: readPositiveIntEnv(
      'BACKEND_RECORD_HISTORY_COLD_FLUSH_HORIZON_MS',
      24 * 60 * 60 * 1000
    ),
    backfillDayWindowMs: readPositiveIntEnv(
      'BACKEND_RECORD_HISTORY_COLD_BACKFILL_DAY_WINDOW_MS',
      30 * 24 * 60 * 60 * 1000
    ),
    partUncompressedBytes: readPositiveIntEnv(
      'BACKEND_RECORD_HISTORY_COLD_PART_UNCOMPRESSED_BYTES',
      32 * 1024 * 1024
    ),
    tableConcurrency: readPositiveIntEnv('BACKEND_RECORD_HISTORY_COLD_TABLE_CONCURRENCY', 4),
    maxRowsPerRun: readNonNegativeIntEnv('BACKEND_RECORD_HISTORY_COLD_MAX_ROWS_PER_RUN', 2_000_000),
    catchupDelayMs: readNonNegativeIntEnv('BACKEND_RECORD_HISTORY_COLD_CATCHUP_DELAY_MS', 5_000),
    readBatchSize: readPositiveIntEnv('BACKEND_RECORD_HISTORY_COLD_READ_BATCH_SIZE', 5000),
    sortMemoryBudgetBytes: readPositiveIntEnv(
      'BACKEND_RECORD_HISTORY_COLD_SORT_MEMORY_BYTES',
      64 * 1024 * 1024
    ),
    sortMergeFanIn: readPositiveIntEnv('BACKEND_RECORD_HISTORY_COLD_SORT_MERGE_FAN_IN', 16),
    // 1MB envelope: safely above a valid max cell (256KB data + meta wrapper),
    // safely below the multi-MB legacy rows that OOM the flush
    truncateValueUnits: readNonNegativeIntEnv(
      'BACKEND_RECORD_HISTORY_COLD_TRUNCATE_VALUE_UNITS',
      1024 * 1024
    ),
    s3ReadTimeoutMs: readPositiveIntEnv('BACKEND_RECORD_HISTORY_COLD_S3_READ_TIMEOUT_MS', 10_000),
    bufferLagAlarmMs: readPositiveIntEnv(
      'BACKEND_RECORD_HISTORY_COLD_BUFFER_LAG_ALARM_MS',
      72 * 60 * 60 * 1000
    ),
  };
};

export const mapWithConcurrency = async <TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> => {
  const results: TResult[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () =>
    (async () => {
      for (let index = next++; index < items.length; index = next++) {
        results[index] = await mapper(items[index], index);
      }
    })()
  );
  await Promise.all(workers);
  return results;
};
