import { readBoolEnv, readNonNegativeIntEnv, readPositiveIntEnv } from '../cold-archive/env';

export interface IRecordRemovalColdConfig {
  // daily BullMQ flush scheduler (on unless disabled)
  flushSchedulerEnabled: boolean;
  // monthly BullMQ compaction scheduler (on unless disabled)
  compactSchedulerEnabled: boolean;
  // delete flushed rows from the PG buffer (on unless disabled)
  deleteEnabled: boolean;
  // reason='archived' rows older than this are flushed (default 30d): the
  // archive UI merges PG + S3, so its hot window only needs to cover the
  // interactive-read sweet spot
  archiveFlushHorizonMs: number;
  // reason='deleted' rows older than this are flushed (default 30d): the
  // recycle bin's record reads merge PG + S3 exactly like the archive UI, so
  // the hot window only needs to cover the interactive-read sweet spot. The
  // plan read window (14/365/1095d) is a read-time filter over the merged
  // stream, not a residency requirement.
  deletedFlushHorizonMs: number;
  // rows younger than this go to day files during backfill (default 30d)
  backfillDayWindowMs: number;
  // cut part at this many uncompressed bytes (default 32MB ≈ 4-8MB compressed)
  partUncompressedBytes: number;
  // concurrent tables per flush run
  tableConcurrency: number;
  // soft row budget per flush run (checked between tables): a fresh upgrade
  // with years of record_trash backlog drains gradually across chained runs
  // instead of one marathon inside the app process; 0 disables the budget
  maxRowsPerRun: number;
  // raw-byte budget per flush run (a payload spike is invisible to the row budget); 0 disables
  maxBytesPerRun: number;
  // chained catch-up runs per SCHEDULED run (bounds a backfill's daily footprint); 0 chains until drained
  maxCatchupHops: number;
  // pause between chained catch-up runs. The budget bounds each RUN's blast
  // radius (memory, transaction size, job-slot occupancy) — waiting between
  // hops adds nothing, so the default is a token breather; each hop is its
  // own queue job and lands on whatever worker is free
  catchupDelayMs: number;
  // keyset batch size for buffer reads (upper bound; adapts down by bytes)
  readBatchSize: number;
  // shared in-memory cap (approximate serialized bytes) for ALL sort runs of
  // one flush or compaction run. Buffer reads can keep every bucket sorter of
  // a table alive at once, so the bound must be global — a per-sorter cap
  // alone multiplies by bucket count (the 2026-07-08 history cn drain OOM).
  // JS heap cost is ~2-3x this figure.
  sortMemoryBudgetBytes: number;
  // max run files a merge opens at once (multi-pass above this). Each open
  // reader holds one decoded row plus its line buffer, and a removal snapshot
  // can be tens of MB, so an unbounded fan-in over a big bucket's runs OOMs.
  // Lower on tiny-heap deployments (effective minimum is 2 — a merge must
  // combine at least two runs per pass or it never converges).
  sortMergeFanIn: number;
  // a field VALUE inside the snapshot's `fields` map longer than this (UTF-16
  // units of its serialized JSON) is replaced with a marker before the row
  // enters the sort pipeline — only the pre-cap anomalies (multi-MB legacy
  // values) that OOM the flush. The 4MB default sits ~16x above the product
  // cell-value maximum, so no legitimate max-size cell is ever truncated;
  // rows still in the PG hot window restore full fidelity. 0 disables.
  truncateFieldUnits: number;
  // whole-snapshot fallback cap (UTF-16 units) after the field pass — catches
  // many capped-but-large fields summing past the bound, and unparseable
  // snapshots the field pass cannot walk. 0 disables.
  truncateRowUnits: number;
  // overall budget for the S3 segment of a removal cold read
  s3ReadTimeoutMs: number;
}

// The feature ships ON by default and migrates transparently: the flush run
// moves record_trash rows past their reason's horizon to cold parts (both
// reasons at ~30d — archive and recycle-bin reads alike merge PG + S3),
// deletes the covered buffer rows, and backlog drains itself under the
// per-run row budget — no operator action, no data movement step.
//
// BACKEND_STORAGE_COLD_ARCHIVE_DISABLED=true is the single kill switch shared
// by every cold-archive feature (record trash, record history); it stops the
// MIGRATION PROCESS only (flush scheduler, compaction, deletion).
// Merged reads are unconditional — reading is not part of the migration, it
// is how migrated data stays visible — so a switched-off process (a staging
// environment sharing the production database, or a rolled-back fleet) still
// serves archived rows from buffer + bucket. An environment that shares its
// database with another one should keep the switch ON permanently and let
// exactly one environment own the migration.
export const recordRemovalColdConfig = (): IRecordRemovalColdConfig => {
  const disabled = readBoolEnv('BACKEND_STORAGE_COLD_ARCHIVE_DISABLED');
  return {
    flushSchedulerEnabled: !disabled,
    compactSchedulerEnabled: !disabled,
    deleteEnabled: !disabled,
    archiveFlushHorizonMs: readPositiveIntEnv(
      'BACKEND_RECORD_REMOVAL_COLD_ARCHIVE_HORIZON_MS',
      30 * 24 * 60 * 60 * 1000
    ),
    deletedFlushHorizonMs: readPositiveIntEnv(
      'BACKEND_RECORD_REMOVAL_COLD_DELETED_HORIZON_MS',
      30 * 24 * 60 * 60 * 1000
    ),
    backfillDayWindowMs: readPositiveIntEnv(
      'BACKEND_RECORD_REMOVAL_COLD_BACKFILL_DAY_WINDOW_MS',
      30 * 24 * 60 * 60 * 1000
    ),
    partUncompressedBytes: readPositiveIntEnv(
      'BACKEND_RECORD_REMOVAL_COLD_PART_UNCOMPRESSED_BYTES',
      32 * 1024 * 1024
    ),
    tableConcurrency: readPositiveIntEnv('BACKEND_RECORD_REMOVAL_COLD_TABLE_CONCURRENCY', 4),
    maxRowsPerRun: readNonNegativeIntEnv('BACKEND_RECORD_REMOVAL_COLD_MAX_ROWS_PER_RUN', 2_000_000),
    maxBytesPerRun: readNonNegativeIntEnv(
      'BACKEND_RECORD_REMOVAL_COLD_MAX_BYTES_PER_RUN',
      2 * 1024 * 1024 * 1024
    ),
    maxCatchupHops: readNonNegativeIntEnv('BACKEND_RECORD_REMOVAL_COLD_MAX_CATCHUP_HOPS', 3),
    catchupDelayMs: readNonNegativeIntEnv('BACKEND_RECORD_REMOVAL_COLD_CATCHUP_DELAY_MS', 5_000),
    readBatchSize: readPositiveIntEnv('BACKEND_RECORD_REMOVAL_COLD_READ_BATCH_SIZE', 5000),
    sortMemoryBudgetBytes: readPositiveIntEnv(
      'BACKEND_RECORD_REMOVAL_COLD_SORT_MEMORY_BYTES',
      64 * 1024 * 1024
    ),
    sortMergeFanIn: readPositiveIntEnv('BACKEND_RECORD_REMOVAL_COLD_SORT_MERGE_FAN_IN', 16),
    truncateFieldUnits: readNonNegativeIntEnv(
      'BACKEND_RECORD_REMOVAL_COLD_TRUNCATE_FIELD_UNITS',
      4 * 1024 * 1024
    ),
    truncateRowUnits: readNonNegativeIntEnv(
      'BACKEND_RECORD_REMOVAL_COLD_TRUNCATE_ROW_UNITS',
      16 * 1024 * 1024
    ),
    s3ReadTimeoutMs: readPositiveIntEnv('BACKEND_RECORD_REMOVAL_COLD_S3_READ_TIMEOUT_MS', 10_000),
  };
};
