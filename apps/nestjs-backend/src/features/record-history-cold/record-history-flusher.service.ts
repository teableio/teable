import { Injectable, Logger } from '@nestjs/common';
import { DataPrismaService } from '@teable/db-data-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { DatabaseRouter } from '../../global/database-router.service';
import { BucketMergeFeeder } from './bucket-merge-feeder';
import { approxColdRowBytes, SortMemoryBudget } from './external-sort';
import type { IColdHistoryRow, IPartBucket, IPartStatsEntry, ITableColdStats } from './part-codec';
import { bucketId, bucketOfDate, parsePartKey } from './part-codec';
import { PartWriter } from './part-writer';
import { RecordHistoryColdStorageService } from './record-history-cold-storage.service';
import { mapWithConcurrency, recordHistoryColdConfig } from './record-history-cold.config';

export interface IColdFlushOptions {
  mode: 'incremental' | 'backfill';
  /** override config gate; backfill runs are upload-only unless explicitly enabled */
  deleteEnabled?: boolean;
  /** override flush horizon (ms before now) */
  horizonMs?: number;
  /** flush exactly these tables, skipping discovery */
  tableIds?: string[];
  /** restrict discovery to these spaces */
  spaceIds?: string[];
  tableConcurrency?: number;
  /** skip the lastModifiedTime bookmark pruning during discovery */
  ignoreBookmarks?: boolean;
  /** override the soft per-run row budget (0 = unlimited) */
  maxRows?: number;
}

export interface ITableFlushResult {
  tableId: string;
  rows: number;
  parts: number;
  uncompressedBytes: number;
  compressedBytes: number;
  deletedRows: number;
  deleteSkippedReason?: string;
  /** rows already fully covered by existing parts — rewrite skipped */
  reconciledRows: number;
  /** oversized legacy before/after values replaced with a marker */
  truncatedValues: number;
  durationMs: number;
  error?: string;
}

export interface IColdFlushRunResult {
  startedAt: string;
  cutoff: string;
  mode: 'incremental' | 'backfill';
  tables: ITableFlushResult[];
  totalRows: number;
  totalParts: number;
  totalCompressedBytes: number;
  totalTruncatedValues: number;
  durationMs: number;
  /** tables discovered but deferred to the next run by the row budget */
  leftoverTables: number;
  budgetExhausted: boolean;
}

interface IDiscoveredGroup {
  kind: 'shared' | 'byodb';
  spaceId?: string;
  bindingId?: string;
  tableIds: string[];
}

interface ITouchedBucket {
  bucket: IPartBucket;
  writtenKeys: Set<string>;
  /** pre-existing keys folded into the rewrite — the only healable keys */
  consumedKeys: Set<string>;
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** target bytes per buffer read batch; the row LIMIT adapts to hit this */
const READ_BATCH_TARGET_BYTES = 8 * 1024 * 1024;
/**
 * first batch of a table probes the row weight before trusting the full cap.
 * Kept small: a table can average 500KB/row (real on the ai fleet), so a
 * large first probe materializes hundreds of MB before the adaptive limit
 * kicks in — worse when several tables probe concurrently.
 */
const READ_BATCH_PROBE_ROWS = 64;
/** floor of 1: a single multi-MB row must be readable one at a time */
const READ_BATCH_MIN_ROWS = 1;

/**
 * rows for the next batch so ~READ_BATCH_TARGET_BYTES come back whatever the
 * row weight: a row-count LIMIT alone lets one fat-JSON table materialize
 * gigabytes in a single batch. The configured cap is the hard upper bound —
 * an operator who lowered readBatchSize below the fat-row floor to cut memory
 * pressure keeps that ceiling, so the floor only applies while it stays under
 * the cap.
 */
export const nextReadBatchLimit = (batchBytes: number, batchRows: number, cap: number): number => {
  const avgRowBytes = Math.max(1, Math.ceil(batchBytes / Math.max(1, batchRows)));
  const target = Math.floor(READ_BATCH_TARGET_BYTES / avgRowBytes);
  return Math.min(cap, Math.max(READ_BATCH_MIN_ROWS, target));
};

/**
 * Flushes record_history buffer rows older than the horizon into cold parts.
 *
 * Discovery never wakes idle tenant dbs: BYODB targets are pruned purely on
 * the main db via max(table_meta.last_modified_time) vs the binding bookmark
 * (touchTableMeta keeps that signal fresh on every record write). Per-table
 * reads/deletes route through DatabaseRouter, so a table is always flushed
 * from its authoritative db.
 */
@Injectable()
export class RecordHistoryFlusherService {
  private readonly logger = new Logger(RecordHistoryFlusherService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly metaFallbackDataPrismaService: DataPrismaService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly databaseRouter: DatabaseRouter,
    private readonly coldStorage: RecordHistoryColdStorageService
  ) {}

  async runFlush(options: IColdFlushOptions): Promise<IColdFlushRunResult> {
    const config = recordHistoryColdConfig();
    const startedAt = new Date();
    const cutoff = new Date(startedAt.getTime() - (options.horizonMs ?? config.flushHorizonMs));
    // a backfill is upload-only unless the caller explicitly asks for deletes;
    // it must never inherit the global delete gate (a dry backfill run with
    // the env flag on would otherwise silently drain the buffer)
    const deleteRequested =
      options.mode === 'backfill'
        ? options.deleteEnabled === true
        : options.deleteEnabled ?? config.deleteEnabled;
    // merged reads are unconditional (every process can serve cold data),
    // so deletion after verified upload is safe wherever it was requested
    const deleteEnabled = deleteRequested;
    const concurrency = options.tableConcurrency ?? config.tableConcurrency;
    const maxRows = options.maxRows ?? config.maxRowsPerRun;
    // ONE budget for the whole run: with tableConcurrency > 1 the concurrent
    // tables' bucket sorters all coexist, so a per-table budget would just
    // multiply by the concurrency again
    const sortBudget = new SortMemoryBudget(config.sortMemoryBudgetBytes);

    const groups = options.tableIds?.length
      ? [{ kind: 'shared' as const, tableIds: options.tableIds }]
      : await this.discoverGroups(options, cutoff);

    const results: ITableFlushResult[] = [];
    const budget = { flushedRows: 0, maxRows };
    let leftoverTables = 0;

    for (const group of groups) {
      const deferredInGroup = await this.flushGroup(group, results, budget, {
        cutoff,
        mode: options.mode,
        deleteEnabled,
        concurrency,
        config,
        sortBudget,
      });
      leftoverTables += deferredInGroup;

      const groupResults = results.filter((result) => group.tableIds.includes(result.tableId));
      const groupFailed = groupResults.some((result) => result.error);
      const groupFullyDrained = groupResults.every(
        (result) => !result.deleteSkippedReason && (result.rows === 0 || result.deletedRows > 0)
      );
      // the bookmark asserts "everything at or before the cutoff left the
      // buffer", so it may only advance when this run actually deleted what
      // it flushed: an upload-only run (delete or read gate off) or a
      // deferred/failed/skipped table leaves rows behind, and advancing
      // would let a then-idle space strand them forever
      if (
        group.kind === 'byodb' &&
        group.bindingId &&
        !groupFailed &&
        deferredInGroup === 0 &&
        deleteEnabled &&
        groupFullyDrained
      ) {
        await this.advanceBookmark(group.bindingId, cutoff).catch((error) =>
          this.logger.warn(`failed to advance flush bookmark for ${group.spaceId}: ${error}`)
        );
      }
    }

    if (leftoverTables > 0) {
      this.logger.log(
        `cold flush row budget reached (${budget.flushedRows} rows); ${leftoverTables} table(s) deferred to the next run`
      );
    }

    return {
      startedAt: startedAt.toISOString(),
      cutoff: cutoff.toISOString(),
      mode: options.mode,
      tables: results,
      totalRows: results.reduce((sum, item) => sum + item.rows, 0),
      totalParts: results.reduce((sum, item) => sum + item.parts, 0),
      totalCompressedBytes: results.reduce((sum, item) => sum + item.compressedBytes, 0),
      totalTruncatedValues: results.reduce((sum, item) => sum + item.truncatedValues, 0),
      durationMs: Date.now() - startedAt.getTime(),
      leftoverTables,
      budgetExhausted: leftoverTables > 0,
    };
  }

  /**
   * flush one discovered group slice-by-slice under the shared row budget
   * (soft, checked between slices: an oversized single table still completes
   * atomically); returns how many tables were deferred to the next run
   */
  private async flushGroup(
    group: IDiscoveredGroup,
    results: ITableFlushResult[],
    budget: { flushedRows: number; maxRows: number },
    run: {
      cutoff: Date;
      mode: 'incremental' | 'backfill';
      deleteEnabled: boolean;
      concurrency: number;
      config: ReturnType<typeof recordHistoryColdConfig>;
      sortBudget: SortMemoryBudget;
    }
  ): Promise<number> {
    let index = 0;
    while (index < group.tableIds.length) {
      if (budget.maxRows > 0 && budget.flushedRows >= budget.maxRows) {
        return group.tableIds.length - index;
      }
      const slice = group.tableIds.slice(index, index + run.concurrency);
      index += slice.length;
      const sliceResults = await mapWithConcurrency(slice, run.concurrency, (tableId) =>
        this.flushTable(
          tableId,
          run.cutoff,
          run.mode,
          run.deleteEnabled,
          run.config,
          run.sortBudget
        ).catch((error): ITableFlushResult => {
          this.logger.error(
            `cold flush failed for table ${tableId}: ${error instanceof Error ? error.stack : error}`
          );
          return {
            tableId,
            rows: 0,
            parts: 0,
            uncompressedBytes: 0,
            compressedBytes: 0,
            deletedRows: 0,
            reconciledRows: 0,
            truncatedValues: 0,
            durationMs: 0,
            error: error instanceof Error ? error.message : String(error),
          } satisfies ITableFlushResult;
        })
      );
      results.push(...sliceResults);
      // reconciled rows count only when their delete actually happened: the
      // deletes are the work the budget bounds. Rows retained by an
      // upload-only run OR a deferred delete (skipped reason set) would be
      // re-counted every run, burning the budget on the same rows forever
      // and starving later tables.
      budget.flushedRows += sliceResults.reduce(
        (sum, item) =>
          sum +
          item.rows +
          (run.deleteEnabled && !item.deleteSkippedReason ? item.reconciledRows : 0),
        0
      );
    }
    return 0;
  }

  /**
   * bookmark writes are monotonic: a manual run with a wide --horizon-hours
   * computes an older cutoff and must not regress the high-water mark (a
   * regressed bookmark only costs an extra reconnect, but staying monotonic
   * keeps "everything at or before the bookmark is flushed" trivially true)
   */
  private async advanceBookmark(bindingId: string, cutoff: Date): Promise<void> {
    await this.prismaService.spaceDataDbBinding.updateMany({
      where: {
        id: bindingId,
        OR: [{ lastHistoryFlushedAt: null }, { lastHistoryFlushedAt: { lt: cutoff } }],
      },
      data: { lastHistoryFlushedAt: cutoff },
    });
  }

  /**
   * discovery: the shared data db always participates (it is the always-on
   * main data db; a space filter narrows its tables rather than skipping it —
   * shared-storage spaces are valid targets too); BYODB dbs only when the
   * meta-side activity signal moved past the bookmark
   */
  private async discoverGroups(
    options: IColdFlushOptions,
    cutoff: Date
  ): Promise<IDiscoveredGroup[]> {
    const groups: IDiscoveredGroup[] = [];

    const sharedTables = await this.listBufferedTables(this.metaFallbackDataPrismaService);
    const knownShared = await this.filterKnownTables(sharedTables, {
      excludeByodbBound: true,
      ...(options.spaceIds?.length ? { spaceIds: options.spaceIds } : undefined),
    });
    if (knownShared.length) {
      groups.push({ kind: 'shared', tableIds: knownShared });
    }

    const bindings = await this.prismaService.spaceDataDbBinding.findMany({
      where: {
        mode: 'byodb',
        state: 'ready',
        ...(options.spaceIds?.length ? { spaceId: { in: options.spaceIds } } : {}),
      },
      select: { id: true, spaceId: true, lastHistoryFlushedAt: true },
    });

    for (const binding of bindings) {
      const group = await this.discoverBindingGroup(binding, options, cutoff);
      if (group) groups.push(group);
    }

    return groups;
  }

  private async discoverBindingGroup(
    binding: { id: string; spaceId: string; lastHistoryFlushedAt: Date | null },
    options: IColdFlushOptions,
    cutoff: Date
  ): Promise<IDiscoveredGroup | undefined> {
    if (!options.ignoreBookmarks) {
      const rows = await this.prismaService.$queryRaw<
        { maxModified: Date | null }[]
      >`SELECT max(tm.last_modified_time) AS "maxModified"
        FROM table_meta tm JOIN base b ON b.id = tm.base_id
        WHERE b.space_id = ${binding.spaceId}`;
      const maxModified = rows[0]?.maxModified;
      if (
        binding.lastHistoryFlushedAt &&
        (!maxModified || maxModified <= binding.lastHistoryFlushedAt)
      ) {
        return undefined; // no record activity since the last flush: never connect (keeps idle dbs asleep)
      }
    }
    try {
      const client = await this.dataDbClientManager.dataPrismaForSpace(binding.spaceId);
      const tableIds = await this.listBufferedTables(client);
      const known = await this.filterKnownTables(tableIds);
      if (known.length) {
        return {
          kind: 'byodb',
          spaceId: binding.spaceId,
          bindingId: binding.id,
          tableIds: known,
        };
      }
      // nothing buffered: still advance the bookmark (to the cutoff, matching
      // what a flush would have covered) so quiet dbs stay skipped
      await this.advanceBookmark(binding.id, cutoff).catch(() => undefined);
    } catch (error) {
      this.logger.warn(`cold flush discovery skipped space ${binding.spaceId}: ${error}`);
    }
    return undefined;
  }

  /** loose index scan: distinct table_id from the buffer at O(#tables × log n) */
  private async listBufferedTables(client: unknown): Promise<string[]> {
    const prisma = this.unwrapClient(client);
    const rows = (await prisma.$queryRawUnsafe(
      `WITH RECURSIVE distinct_tables AS (
         SELECT min(table_id) AS table_id FROM record_history
         UNION ALL
         SELECT (SELECT min(r.table_id) FROM record_history r WHERE r.table_id > d.table_id)
         FROM distinct_tables d WHERE d.table_id IS NOT NULL
       )
       SELECT table_id AS "tableId" FROM distinct_tables WHERE table_id IS NOT NULL`
    )) as { tableId: string }[];
    return rows.map((row) => row.tableId);
  }

  /**
   * drop buffer rows of deleted/unknown tables from the work list (abandoned
   * copies); for the shared group also drop every table whose space has a
   * non-default binding, REGARDLESS of state — this must mirror the
   * DatabaseRouter exactly, which never falls back to the shared db for
   * mode='byodb' (ready/migrating/error route to the tenant connection,
   * anything else throws). Flushing a shared-db copy the router would not
   * serve corrupts an active migration's row-count checks (copy/validate),
   * and for error/disabled it would operate on the wrong database entirely.
   * Those rows simply wait untiered until the binding is repaired or reset.
   */
  private async filterKnownTables(
    tableIds: string[],
    options?: { excludeByodbBound?: boolean; spaceIds?: string[] }
  ): Promise<string[]> {
    if (!tableIds.length) return [];
    const known = await this.prismaService.tableMeta.findMany({
      where: {
        id: { in: tableIds },
        ...(options?.spaceIds?.length
          ? { base: { spaceId: { in: options.spaceIds } } }
          : undefined),
      },
      select: {
        id: true,
        base: {
          select: { space: { select: { dataDbBinding: { select: { mode: true, state: true } } } } },
        },
      },
    });
    const keepSet = new Set(
      known
        .filter((table) => {
          if (!options?.excludeByodbBound) return true;
          const binding = table.base.space.dataDbBinding;
          return !binding || binding.mode === 'default';
        })
        .map((table) => table.id)
    );
    const dropped = tableIds.filter((id) => !keepSet.has(id));
    if (dropped.length) {
      this.logger.warn(
        `cold flush skipping ${dropped.length} buffered table(s) (no table_meta or byodb-routed): ${dropped.slice(0, 5).join(',')}`
      );
    }
    return tableIds.filter((id) => keepSet.has(id));
  }

  /**
   * map a buffer row to a cold row. before/after were already truncated (if
   * over-cap) in the readBatch SQL, so a multi-MB value never reaches here;
   * truncatedCount comes from the per-field SQL flags and counts each of
   * before/after separately.
   */
  private buildColdRow(row: {
    id: string;
    recordId: string;
    fieldId: string;
    before: string;
    after: string;
    beforeTruncated: boolean;
    afterTruncated: boolean;
    createdTime: Date;
    createdBy: string;
  }): { row: IColdHistoryRow; truncatedCount: number; rawBytes: number } {
    const coldRow: IColdHistoryRow = {
      id: row.id,
      recordId: row.recordId,
      fieldId: row.fieldId,
      before: row.before,
      after: row.after,
      createdTime: row.createdTime.toISOString(),
      createdBy: row.createdBy,
    };
    return {
      row: coldRow,
      truncatedCount: Number(row.beforeTruncated) + Number(row.afterTruncated),
      rawBytes: approxColdRowBytes(coldRow),
    };
  }

  async flushTable(
    tableId: string,
    cutoff: Date,
    mode: 'incremental' | 'backfill',
    deleteEnabled: boolean,
    config = recordHistoryColdConfig(),
    sortBudget = new SortMemoryBudget(config.sortMemoryBudgetBytes)
  ): Promise<ITableFlushResult> {
    const startedAt = Date.now();
    const qualified = await this.qualifiedHistoryTable(tableId);
    const dayWindowStart = new Date(Date.now() - config.backfillDayWindowMs);

    // buckets whose rows are already fully persisted (stats corroborated by a
    // live part listing) skip the merge-rewrite entirely — the "upload-only →
    // delete-enabled" transition then reconciles and deletes without redoing
    // any upload work
    const coverage = await this.planBucketCoverage(tableId, qualified, cutoff, dayWindowStart);

    const feeders = new Map<string, BucketMergeFeeder>();
    // bucketing is date-based regardless of mode: a steady-state daily run
    // only ever sees <30d rows (day files), while the very first run after
    // an upgrade sees the whole historical backlog and lands it directly as
    // month files — a zero-ops instance gets the backfill layout for free

    const monthParts = new Map<
      string,
      Awaited<ReturnType<RecordHistoryColdStorageService['listMonthParts']>>
    >();
    const feederFor = async (createdTime: string): Promise<BucketMergeFeeder> => {
      const created = new Date(createdTime);
      const kind = created >= dayWindowStart ? 'day' : 'month';
      const bucket: IPartBucket = bucketOfDate(created, kind);
      const id = bucketId(bucket);
      let feeder = feeders.get(id);
      if (!feeder) {
        // a bucket may already hold parts from an earlier run whose buffer
        // rows were deleted since — those must be merged back in, not clobbered
        let parts = monthParts.get(bucket.yyyymm);
        if (!parts) {
          parts = await this.coldStorage.listMonthParts(tableId, bucket.yyyymm);
          monthParts.set(bucket.yyyymm, parts);
        }
        const existing = parts.filter(
          (part) => part.kind === bucket.kind && (bucket.kind === 'month' || part.dd === bucket.dd)
        );
        // new keys start past the existing ones: the feeder is still streaming
        // the old parts while we upload, and S3 gives no guarantees for a GET
        // racing an overwrite of the same key; healing removes the old keys
        // once the rewrite has been verified
        const startSeq = existing.reduce((max, part) => Math.max(max, part.seq + 1), 0);
        const writer = new PartWriter({
          store: this.coldStorage.partStore,
          rootDir: this.coldStorage.rootDir,
          tableId,
          bucket,
          partUncompressedBytes: config.partUncompressedBytes,
          startSeq,
        });
        feeder = new BucketMergeFeeder(
          writer,
          existing,
          this.coldStorage,
          sortBudget,
          config.sortMergeFanIn,
          config.truncateValueUnits
        );
        feeders.set(id, feeder);
      }
      return feeder;
    };

    let flushedRows = 0;
    let truncatedValues = 0;
    let lastKey: { recordId: string; createdTime: Date; id: string } | undefined;
    const streamNothing = coverage.streamRanges !== undefined && coverage.streamRanges.length === 0;
    let batchLimit = Math.min(READ_BATCH_PROBE_ROWS, config.readBatchSize);
    const allEntries: IPartStatsEntry[] = [];
    const touched = new Map<string, ITouchedBucket>();
    try {
      while (!streamNothing) {
        const batch = await this.readBatch(
          tableId,
          qualified,
          cutoff,
          batchLimit,
          config.truncateValueUnits,
          lastKey,
          coverage.streamRanges
        );
        if (batch.length === 0) break;
        const last = batch[batch.length - 1];
        lastKey = { recordId: last.recordId, createdTime: last.createdTime, id: last.id };
        let batchBytes = 0;
        for (let i = 0; i < batch.length; i++) {
          const built = this.buildColdRow(batch[i]);
          // sizing uses the (already truncated) size PG returned — bounds the
          // next read; an oversized value was capped in SQL so it never reached
          // JS memory in the first place
          batchBytes += built.rawBytes;
          truncatedValues += built.truncatedCount;
          // drop the source row's reference as we go: with multi-MB rows the
          // whole batch array would otherwise stay live until the loop ends
          (batch as unknown as (unknown | undefined)[])[i] = undefined;
          await (await feederFor(built.row.createdTime)).push(built.row);
          flushedRows += 1;
        }
        if (batch.length < batchLimit) break;
        batchLimit = nextReadBatchLimit(batchBytes, batch.length, config.readBatchSize);
      }

      for (const [id, feeder] of feeders) {
        const entries = await feeder.finish();
        allEntries.push(...entries);
        touched.set(id, {
          bucket: feeder.bucket,
          writtenKeys: new Set(entries.map((e) => e.key)),
          consumedKeys: feeder.consumedKeys,
        });
      }
    } catch (error) {
      // a mid-stream failure (a spill error surfaced by another table's
      // eviction, an S3 hiccup, a feeder still unfinished) must not leave
      // this table's feeders charged against the run-wide budget and
      // evictable for the rest of the run. abort() frees each sorter's
      // budget charge, temp files and registry slot; it is idempotent, so
      // already-finished feeders are unaffected.
      await Promise.allSettled([...feeders.values()].map((feeder) => feeder.abort()));
      throw error;
    }

    const metrics = [...feeders.values()].reduce(
      (sum, feeder) => ({
        parts: sum.parts + feeder.metrics.parts,
        uncompressedBytes: sum.uncompressedBytes + feeder.metrics.uncompressedBytes,
        compressedBytes: sum.compressedBytes + feeder.metrics.compressedBytes,
      }),
      { parts: 0, uncompressedBytes: 0, compressedBytes: 0 }
    );

    if (touched.size > 0) {
      await this.healStaleParts(tableId, touched);
      await this.updateStats(tableId, touched, allEntries);
    }

    let deletedRows = 0;
    let deleteSkippedReason: string | undefined;
    if (deleteEnabled && flushedRows + coverage.coveredRows > 0) {
      const outcome = await this.reconcileAndDelete(
        tableId,
        qualified,
        cutoff,
        flushedRows + coverage.coveredRows
      );
      deletedRows = outcome.deletedRows;
      deleteSkippedReason = outcome.skippedReason;
    }

    return {
      tableId,
      rows: flushedRows,
      parts: metrics.parts,
      uncompressedBytes: metrics.uncompressedBytes,
      compressedBytes: metrics.compressedBytes,
      deletedRows,
      deleteSkippedReason,
      reconciledRows: coverage.coveredRows,
      truncatedValues,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Coverage plan for the "upload-only → delete-enabled" transition (and for
   * idempotent re-runs): a bucket whose buffer rows are ALREADY fully
   * persisted skips the merge-rewrite. "Fully persisted" is judged by an
   * exact triple match — row count and min/max created_time — between the
   * buffer's per-bucket aggregate and the bucket's stats entries, AND a
   * live listing that corroborates the stats keys one-to-one (stats alone
   * are advisory; skipping an upload on stale stats would lose rows at the
   * delete step). Buffer rows are insert-only with db-stamped timestamps and
   * uploads came from this very buffer, so a triple match implies set
   * equality for our write pattern.
   *
   * Returns the rows covered this way plus the canonical time ranges of the
   * NON-covered buckets to stream (undefined = stream everything; [] =
   * nothing left to stream).
   */
  private async planBucketCoverage(
    tableId: string,
    qualified: string,
    cutoff: Date,
    dayWindowStart: Date
  ): Promise<{ coveredRows: number; streamRanges?: { lo: Date; hi: Date }[] }> {
    const noCoverage = { coveredRows: 0, streamRanges: undefined };
    const buckets = (await this.databaseRouter.queryDataPrismaForTable(
      tableId,
      `SELECT to_char("created_time", 'YYYYMM') AS "yyyymm",
         CASE WHEN "created_time" >= $3 THEN to_char("created_time", 'DD') END AS "dd",
         count(*)::text AS "count",
         min("created_time") AS "min", max("created_time") AS "max"
       FROM ${qualified}
       WHERE "table_id" = $1 AND "created_time" < $2
       GROUP BY 1, 2`,
      tableId,
      cutoff,
      dayWindowStart
    )) as { yyyymm: string; dd: string | null; count: string; min: Date; max: Date }[];
    if (buckets.length === 0) {
      return { coveredRows: 0, streamRanges: [] };
    }

    const stats = await this.coldStorage.readStats(tableId);
    if (!stats) return noCoverage;

    const statsByBucket = this.groupStatsByBucket(stats);
    const listedByBucket = await this.listPartsByBucket(tableId, [
      ...new Set(buckets.map((bucket) => bucket.yyyymm)),
    ]);

    let coveredRows = 0;
    const streamRanges: { lo: Date; hi: Date }[] = [];
    for (const bucket of buckets) {
      const id = bucket.dd ? `${bucket.yyyymm}/${bucket.dd}` : `${bucket.yyyymm}/m`;
      if (this.isBucketCovered(statsByBucket.get(id), listedByBucket.get(id), bucket)) {
        coveredRows += Number(bucket.count);
      } else {
        streamRanges.push(this.bucketRange(bucket, cutoff, dayWindowStart));
      }
    }

    if (coveredRows === 0) return noCoverage;
    if (streamRanges.length > 64) {
      this.logger.warn(
        `cold flush coverage: ${streamRanges.length} uncovered bucket(s) exceed the predicate cap; falling back to a full rewrite for ${tableId}`
      );
      return noCoverage;
    }
    return { coveredRows, streamRanges };
  }

  private groupStatsByBucket(stats: ITableColdStats) {
    const byBucket = new Map<
      string,
      { keys: Set<string>; rows: number; min: string; max: string }
    >();
    for (const [key, entry] of Object.entries(stats.parts)) {
      const parsed = parsePartKey(this.coldStorage.rootDir, key);
      if (!parsed) continue;
      const id = bucketId(parsed);
      const agg = byBucket.get(id) ?? {
        keys: new Set<string>(),
        rows: 0,
        min: entry.minCreatedTime,
        max: entry.maxCreatedTime,
      };
      agg.keys.add(key);
      agg.rows += entry.rows;
      if (entry.minCreatedTime < agg.min) agg.min = entry.minCreatedTime;
      if (entry.maxCreatedTime > agg.max) agg.max = entry.maxCreatedTime;
      byBucket.set(id, agg);
    }
    return byBucket;
  }

  private async listPartsByBucket(tableId: string, months: string[]) {
    const byBucket = new Map<string, Set<string>>();
    for (const yyyymm of months) {
      for (const part of await this.coldStorage.listMonthParts(tableId, yyyymm)) {
        const id = bucketId(part);
        const set = byBucket.get(id) ?? new Set<string>();
        set.add(part.key);
        byBucket.set(id, set);
      }
    }
    return byBucket;
  }

  private isBucketCovered(
    agg: { keys: Set<string>; rows: number; min: string; max: string } | undefined,
    listed: Set<string> | undefined,
    bucket: { count: string; min: Date; max: Date }
  ): boolean {
    return (
      agg !== undefined &&
      listed !== undefined &&
      agg.keys.size === listed.size &&
      [...agg.keys].every((key) => listed.has(key)) &&
      agg.rows === Number(bucket.count) &&
      agg.min === bucket.min.toISOString() &&
      agg.max === bucket.max.toISOString()
    );
  }

  /** canonical time range of a bucket, clamped to the day-window boundary and cutoff */
  private bucketRange(
    bucket: { yyyymm: string; dd: string | null },
    cutoff: Date,
    dayWindowStart: Date
  ): { lo: Date; hi: Date } {
    const year = Number(bucket.yyyymm.slice(0, 4));
    const month = Number(bucket.yyyymm.slice(4, 6));
    if (bucket.dd) {
      const dayStart = new Date(Date.UTC(year, month - 1, Number(bucket.dd)));
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      return {
        lo: dayStart > dayWindowStart ? dayStart : dayWindowStart,
        hi: dayEnd < cutoff ? dayEnd : cutoff,
      };
    }
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const nextMonth = new Date(Date.UTC(year, month, 1));
    let hi = nextMonth < dayWindowStart ? nextMonth : dayWindowStart;
    if (cutoff < hi) hi = cutoff;
    return { lo: monthStart, hi };
  }

  private async qualifiedHistoryTable(tableId: string): Promise<string> {
    const url = await this.dataDbClientManager.getDataDatabaseUrlForTable(tableId);
    const schema = new URL(url).searchParams.get('schema') || 'public';
    return `${quoteIdent(schema)}."record_history"`;
  }

  private async readBatch(
    tableId: string,
    qualified: string,
    cutoff: Date,
    limit: number,
    maxValueUnits: number,
    after?: { recordId: string; createdTime: Date; id: string },
    ranges?: { lo: Date; hi: Date }[]
  ) {
    // Read on the table's own pg connection via the NATIVE pg client (knex /
    // node-postgres), routed per-table by dataKnexForTable exactly as the Prisma
    // path was — a BYODB table hits the tenant DB over its own connection string,
    // a shared table the main DB. Only the DRIVER changes: Prisma's rust engine
    // deterministically failed readBatch on one shared-DB table with "Failed to
    // convert rust String into napi string" even though the values are valid,
    // sub-cap UTF-8 (node-postgres reads the exact probe query fine), so the
    // native driver sidesteps that engine quirk and the table drains.
    const bindings: unknown[] = [];
    // positional binds are consumed left-to-right, so emit them in SQL order
    const bind = (value: unknown) => {
      bindings.push(value);
      return '?';
    };
    // created_time is TIMESTAMP without time zone storing UTC. node-postgres binds
    // a Date using the process timezone, so pass UTC naive strings (and read the
    // column back as a UTC instant below) to keep the predicate window identical
    // to the Prisma path on any deployment TZ.
    const bindTs = (value: Date) => `${bind(value.toISOString().slice(0, -1))}::timestamp`;
    const tableIdBind = bind(tableId);
    const cutoffBind = bindTs(cutoff);
    let rangeClause = '';
    if (ranges && ranges.length > 0) {
      const parts = ranges.map(
        (range) =>
          `("created_time" >= ${bindTs(range.lo)} AND "created_time" < ${bindTs(range.hi)})`
      );
      rangeClause = ` AND (${parts.join(' OR ')})`;
    }
    let afterClause = '';
    if (after) {
      afterClause = ` AND ("record_id", "created_time", "id") > (${bind(after.recordId)}, ${bindTs(after.createdTime)}, ${bind(after.id)})`;
    }
    // cap is a server config integer (not user input), so it is inlined — that
    // keeps it out of the positional binds and lets it repeat across the CASEs.
    // Over-cap before/after are still replaced with a marker IN SQL so a multi-MB
    // value never crosses the wire; the marker mirrors coldTruncatedMarker().
    // cap<=0 disables.
    const cap = Math.max(0, Math.floor(maxValueUnits));
    const marker = (lenCol: string) =>
      `'{"data":"[value too large, cold-truncated (' || ${lenCol} || ' chars)]","coldTruncated":true,"units":' || ${lenCol} || '}'`;
    const trunc = (lenCol: string) => `${cap} > 0 AND ${lenCol} > ${cap}`;
    const sql = `SELECT "id", "recordId", "fieldId", "createdTime", "createdBy",
         CASE WHEN ${trunc('"bl"')} THEN ${marker('"bl"')} ELSE "before" END AS "before",
         CASE WHEN ${trunc('"al"')} THEN ${marker('"al"')} ELSE "after" END AS "after",
         (${trunc('"bl"')}) AS "beforeTruncated",
         (${trunc('"al"')}) AS "afterTruncated"
       FROM (
         SELECT "id", "record_id" AS "recordId", "field_id" AS "fieldId",
           "before", "after",
           to_char("created_time", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdTime",
           "created_by" AS "createdBy",
           char_length("before") AS "bl", char_length("after") AS "al"
         FROM ${qualified}
         WHERE "table_id" = ${tableIdBind} AND "created_time" < ${cutoffBind}${rangeClause}${afterClause}
         ORDER BY "record_id", "created_time", "id" LIMIT ${Math.max(1, Math.floor(limit))}
       ) "sub"`;
    const knex = await this.databaseRouter.dataKnexForTable(tableId);
    const result = await knex.raw(sql, bindings);
    const raw = ((result as { rows?: unknown[] }).rows ?? (result as unknown[])) as Array<{
      id: string;
      recordId: string;
      fieldId: string;
      before: string;
      after: string;
      beforeTruncated: boolean;
      afterTruncated: boolean;
      createdTime: string;
      createdBy: string;
    }>;
    // createdTime is a UTC ISO string (see to_char above); parse it to a Date so
    // buildColdRow's toISOString() stays UTC regardless of the process timezone.
    return raw.map((row) => ({ ...row, createdTime: new Date(row.createdTime) }));
  }

  /**
   * deterministic self-healing, scoped to what this run actually superseded:
   * only the pre-existing keys the bucket feeder folded into its rewrite may
   * be deleted. A same-bucket key that appeared after the feeder's listing
   * belongs to a concurrent flush (manual/catch-up overlapping the daily job)
   * and must survive — read-side id-dedup absorbs the temporary duplication.
   */
  private async healStaleParts(
    tableId: string,
    touched: Map<string, ITouchedBucket>
  ): Promise<void> {
    const staleKeys: string[] = [];
    for (const { writtenKeys, consumedKeys } of touched.values()) {
      for (const key of consumedKeys) {
        if (!writtenKeys.has(key)) staleKeys.push(key);
      }
    }
    if (staleKeys.length) {
      this.logger.warn(`cold flush healing ${staleKeys.length} superseded part(s) for ${tableId}`);
      await this.coldStorage.deleteKeys(staleKeys);
    }
  }

  private async updateStats(
    tableId: string,
    touched: Map<string, ITouchedBucket>,
    entries: IPartStatsEntry[]
  ): Promise<void> {
    const stats: ITableColdStats = (await this.coldStorage.readStats(tableId)) ?? {
      version: 1,
      tableId,
      parts: {},
    };
    // drop only entries for keys this run consumed (their parts are healed
    // away above); a concurrent run's entries stay intact
    for (const { consumedKeys } of touched.values()) {
      for (const key of consumedKeys) {
        delete stats.parts[key];
      }
    }
    for (const entry of entries) {
      stats.parts[entry.key] = entry;
    }
    await this.coldStorage.writeStats(tableId, stats);
  }

  /**
   * range delete with a count reconciliation latch: the cutoff was pinned at
   * run start and created_time is stamped by the db at insert, so the set
   * "rows < cutoff" is stable — unless a straggler write (listener backlog
   * > horizon) slipped in after the read. The count check catches exactly
   * that case and defers deletion to the next run instead of losing rows.
   */
  private async reconcileAndDelete(
    tableId: string,
    qualified: string,
    cutoff: Date,
    flushedRows: number
  ): Promise<{ deletedRows: number; skippedReason?: string }> {
    const countRows = (await this.databaseRouter.queryDataPrismaForTable(
      tableId,
      `SELECT count(*)::text AS "count" FROM ${qualified} WHERE "table_id" = $1 AND "created_time" < $2`,
      tableId,
      cutoff
    )) as { count: string }[];
    const count = Number(countRows[0]?.count ?? '0');
    if (count !== flushedRows) {
      return {
        deletedRows: 0,
        skippedReason: `count-mismatch buffered=${count} flushed=${flushedRows} (late writes below cutoff; next run re-flushes)`,
      };
    }
    try {
      return { deletedRows: await this.deleteFlushedRows(tableId, qualified, cutoff, flushedRows) };
    } catch (error) {
      // serialization failure or timeout: rows stay buffered, next run retries
      return {
        deletedRows: 0,
        skippedReason: `delete-deferred: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  /**
   * snapshot-consistent delete: count and delete run inside one REPEATABLE
   * READ transaction, so a history row whose transaction opened before the
   * cutoff but commits between the two statements is invisible to the delete
   * and survives for the next run — the range predicate alone would remove it
   * without it ever having been uploaded. (This is why the delete is NOT split
   * into separately-committed batches: a fresh snapshot per batch would see
   * such a late row and delete it un-uploaded.)
   *
   * A SINGLE `DELETE ... WHERE table_id AND created_time < cutoff` — one O(n)
   * pass over the (table_id, created_time) index (EXPLAIN: Index Scan; ~4 min
   * for 7.8M rows). The previous ctid-`LIMIT` batching loop re-scanned the
   * not-yet-vacuumable dead tuples every iteration, so each pass traversed more
   * dead index entries: O(n^2), which timed out the 30-min transaction on 10M+
   * row tables (the 2026-07-09 cn stall — two tables at 15M / 7.8M rows whose
   * delete rolled back every run, so they never drained). A table beyond a few
   * tens of millions of cold rows can still exceed the timeout; it then defers
   * to the next run rather than crashing.
   */
  private async deleteFlushedRows(
    tableId: string,
    qualified: string,
    cutoff: Date,
    expectedRows: number
  ): Promise<number> {
    const client = (await this.dataDbClientManager.dataPrismaForTable(tableId)) as unknown as {
      $transaction: <T>(
        fn: (tx: {
          $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown>;
          $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<number>;
        }) => Promise<T>,
        options?: { isolationLevel?: string; timeout?: number; maxWait?: number }
      ) => Promise<T>;
    };
    return await client.$transaction(
      async (tx) => {
        const countRows = (await tx.$queryRawUnsafe(
          `SELECT count(*)::int AS "count" FROM ${qualified} WHERE "table_id" = $1 AND "created_time" < $2`,
          tableId,
          cutoff
        )) as { count: number }[];
        const count = Number(countRows[0]?.count ?? 0);
        if (count !== expectedRows) {
          throw new Error(
            `snapshot count ${count} != flushed ${expectedRows}; rows changed since reconciliation`
          );
        }
        return await tx.$executeRawUnsafe(
          `DELETE FROM ${qualified} WHERE "table_id" = $1 AND "created_time" < $2`,
          tableId,
          cutoff
        );
      },
      { isolationLevel: 'RepeatableRead', timeout: 30 * 60_000, maxWait: 30_000 }
    );
  }

  private unwrapClient(client: unknown): {
    $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  } {
    const candidate = client as {
      txClient?: () => unknown;
      $queryRawUnsafe?: (query: string, ...values: unknown[]) => Promise<unknown>;
    };
    if (typeof candidate.txClient === 'function') {
      return candidate.txClient() as ReturnType<RecordHistoryFlusherService['unwrapClient']>;
    }
    return candidate as ReturnType<RecordHistoryFlusherService['unwrapClient']>;
  }
}
