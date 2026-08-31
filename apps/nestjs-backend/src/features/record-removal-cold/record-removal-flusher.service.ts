import { Injectable, Logger } from '@nestjs/common';
import { DataPrismaService } from '@teable/db-data-prisma';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { DatabaseRouter } from '../../global/database-router.service';
import { mapWithConcurrency } from '../../utils/map-with-concurrency';
import { bucketRange, groupStatsByBucket, isBucketCovered } from '../cold-archive/bucket-coverage';
import { nextReadBatchLimit, READ_BATCH_PROBE_ROWS } from '../cold-archive/read-batch';
import { BucketMergeFeeder } from './bucket-merge-feeder';
import { approxRemovalRowBytes, SortMemoryBudget } from './external-sort';
import type {
  ColdRemovalReason,
  IColdRemovalRow,
  IPartBucket,
  IPartStatsEntry,
  ITableColdStats,
} from './part-codec';
import {
  bucketId,
  bucketOfDate,
  COLD_REMOVAL_REASONS,
  parsePartKey,
  truncateRemovalRow,
} from './part-codec';
import { PartWriter } from './part-writer';
import { RecordRemovalColdStorageService } from './record-removal-cold-storage.service';
import { recordRemovalColdConfig } from './record-removal-cold.config';

export interface IColdFlushOptions {
  mode: 'incremental' | 'backfill';
  // override config gate; backfill runs are upload-only unless explicitly enabled
  deleteEnabled?: boolean;
  // override the reason='archived' flush horizon (ms before now)
  archiveHorizonMs?: number;
  // override the reason='deleted' flush horizon (ms before now)
  deletedHorizonMs?: number;
  // flush exactly these tables, skipping discovery
  tableIds?: string[];
  // restrict discovery to these spaces
  spaceIds?: string[];
  tableConcurrency?: number;
  // skip the lastModifiedTime bookmark pruning during discovery
  ignoreBookmarks?: boolean;
  // override the soft per-run row budget (0 = unlimited)
  maxRows?: number;
  // override the soft per-run raw-byte budget (0 = unlimited)
  maxBytes?: number;
}

export interface ITableFlushResult {
  tableId: string;
  reason: ColdRemovalReason;
  rows: number;
  parts: number;
  uncompressedBytes: number;
  compressedBytes: number;
  deletedRows: number;
  deleteSkippedReason?: string;
  // rows already fully covered by existing parts — rewrite skipped
  reconciledRows: number;
  // rows whose snapshot was capped by truncateRemovalRow before upload
  truncatedRows: number;
  durationMs: number;
  error?: string;
}

export interface IColdFlushRunResult {
  startedAt: string;
  // per-reason cutoffs (both ≈ 30d by default; each independently overridable)
  cutoffs: Record<ColdRemovalReason, string>;
  mode: 'incremental' | 'backfill';
  tables: ITableFlushResult[];
  totalRows: number;
  totalParts: number;
  totalCompressedBytes: number;
  totalTruncatedRows: number;
  // buffer rows of hard-deleted tables swept from the buffer this run
  orphanRowsDeleted: number;
  durationMs: number;
  // (table, reason) units discovered but deferred to the next run by the row/byte budget
  leftoverTables: number;
  budgetExhausted: boolean;
  // buffer rows still past their reason's cutoff on the dbs this run visited
  backlogRows: number;
}

interface IDiscoveredGroup {
  kind: 'shared' | 'byodb';
  spaceId?: string;
  bindingId?: string;
  tableIds: string[];
}

// the flush work unit: reason is part of the S3 key prefix and stats path, so
// each (table, reason) pair runs the whole coverage/stream/heal/stats/delete
// pipeline independently against its own cutoff
interface IFlushWorkItem {
  tableId: string;
  reason: ColdRemovalReason;
  cutoff: Date;
}

// mutable accumulator threaded through discovery to tally orphan deletions
interface IOrphanCleanup {
  enabled: boolean;
  deletedRows: number;
}

interface ITouchedBucket {
  bucket: IPartBucket;
  writtenKeys: Set<string>;
  // pre-existing keys folded into the rewrite — the only healable keys
  consumedKeys: Set<string>;
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export { nextReadBatchLimit } from '../cold-archive/read-batch';

// Flushes record_trash buffer rows older than their reason's horizon into
// cold parts — per-reason horizons (both ~30d by default: archive and
// recycle-bin reads alike merge PG + S3, so the hot window only covers the
// interactive-read sweet spot).
//
// Discovery never wakes idle tenant dbs: BYODB targets are pruned purely on
// the main db via max(table_meta.last_modified_time) vs the binding bookmark
// (touchTableMeta keeps that signal fresh on every record write, and removal
// IS a record write). Per-table reads/deletes route through DatabaseRouter,
// so a table is always flushed from its authoritative db.
@Injectable()
export class RecordRemovalFlusherService {
  private readonly logger = new Logger(RecordRemovalFlusherService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly metaFallbackDataPrismaService: DataPrismaService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly databaseRouter: DatabaseRouter,
    private readonly coldStorage: RecordRemovalColdStorageService
  ) {}

  async runFlush(options: IColdFlushOptions): Promise<IColdFlushRunResult> {
    const config = recordRemovalColdConfig();
    const startedAt = new Date();
    const cutoffs: Record<ColdRemovalReason, Date> = {
      archived: new Date(
        startedAt.getTime() - (options.archiveHorizonMs ?? config.archiveFlushHorizonMs)
      ),
      deleted: new Date(
        startedAt.getTime() - (options.deletedHorizonMs ?? config.deletedFlushHorizonMs)
      ),
    };
    // a backfill is upload-only unless the caller explicitly asks for deletes;
    // it must never inherit the global delete gate (a dry backfill run with
    // the env flag on would otherwise silently drain the buffer). Merged reads
    // are unconditional (every process can serve cold data), so deletion after
    // verified upload is safe wherever it was requested.
    const deleteEnabled =
      options.mode === 'backfill'
        ? options.deleteEnabled === true
        : options.deleteEnabled ?? config.deleteEnabled;
    const concurrency = options.tableConcurrency ?? config.tableConcurrency;
    const maxRows = options.maxRows ?? config.maxRowsPerRun;
    const maxBytes = options.maxBytes ?? config.maxBytesPerRun;
    // ONE budget for the whole run: with tableConcurrency > 1 the concurrent
    // work items' bucket sorters all coexist, so a per-item budget would just
    // multiply by the concurrency again
    const sortBudget = new SortMemoryBudget(config.sortMemoryBudgetBytes);

    // orphan buffer rows (trash of hard-deleted tables) are swept during
    // discovery, on whichever db holds them, under the same delete gate as a
    // normal flush. A manual tableIds run targets specific live tables and skips
    // discovery, so it does not sweep.
    const orphanCleanup: IOrphanCleanup = { enabled: deleteEnabled, deletedRows: 0 };
    const groups = options.tableIds?.length
      ? [{ kind: 'shared' as const, tableIds: options.tableIds }]
      : await this.discoverGroups(options, cutoffs, orphanCleanup);

    const results: ITableFlushResult[] = [];
    const budget = { flushedRows: 0, flushedBytes: 0, maxRows, maxBytes };
    let leftoverTables = 0;

    for (const group of groups) {
      const deferredInGroup = await this.flushGroup(group, results, budget, {
        cutoffs,
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
      // The single bookmark asserts "every ARCHIVED row at or before the
      // bookmark left the buffer", so it advances to the ARCHIVED cutoff (the
      // newest of the two) and only when this run actually deleted what it
      // flushed for BOTH reasons: an upload-only run (delete gate off) or a
      // deferred/failed/skipped item leaves rows behind, and advancing would
      // let a then-idle space strand them forever. Rows age past their
      // horizon while a space sits idle (no new activity signal), so bookmark
      // pruning alone would defer them — the monthly ignoreBookmarks sweep
      // bounds that deferral to a month.
      if (
        group.kind === 'byodb' &&
        group.bindingId &&
        !groupFailed &&
        deferredInGroup === 0 &&
        deleteEnabled &&
        groupFullyDrained
      ) {
        await this.advanceBookmark(group.bindingId, cutoffs.archived).catch((error) =>
          this.logger.warn(`failed to advance flush bookmark for ${group.spaceId}: ${error}`)
        );
      }
    }

    if (leftoverTables > 0) {
      this.logger.log(
        `removal cold flush budget reached (${budget.flushedRows} rows, ${budget.flushedBytes} bytes); ${leftoverTables} table-reason unit(s) deferred to the next run`
      );
    }

    // a manual table list bypasses discovery, so there is no visited-db set
    const backlogRows = options.tableIds?.length ? 0 : await this.countBacklog(groups, cutoffs);

    return {
      startedAt: startedAt.toISOString(),
      cutoffs: {
        archived: cutoffs.archived.toISOString(),
        deleted: cutoffs.deleted.toISOString(),
      },
      mode: options.mode,
      tables: results,
      totalRows: results.reduce((sum, item) => sum + item.rows, 0),
      totalParts: results.reduce((sum, item) => sum + item.parts, 0),
      totalCompressedBytes: results.reduce((sum, item) => sum + item.compressedBytes, 0),
      totalTruncatedRows: results.reduce((sum, item) => sum + item.truncatedRows, 0),
      orphanRowsDeleted: orphanCleanup.deletedRows,
      durationMs: Date.now() - startedAt.getTime(),
      leftoverTables,
      budgetExhausted: leftoverTables > 0,
      backlogRows,
    };
  }

  /**
   * Archivable rows left behind. Counted only on the dbs this run already
   * opened — waking a bookmark-pruned tenant db to count it would defeat the
   * discovery pruning that keeps idle dbs asleep.
   */
  private async countBacklog(
    groups: IDiscoveredGroup[],
    cutoffs: Record<ColdRemovalReason, Date>
  ): Promise<number> {
    let backlog = 0;
    for (const group of groups) {
      if (!group.tableIds.length) continue;
      try {
        const client =
          group.kind === 'byodb' && group.spaceId
            ? await this.dataDbClientManager.dataPrismaForSpace(group.spaceId)
            : this.metaFallbackDataPrismaService;
        // derived from COLD_REMOVAL_REASONS so a new reason cannot escape the count
        const bindings: unknown[] = [group.tableIds];
        const reasonPredicates = COLD_REMOVAL_REASONS.map((reason) => {
          bindings.push(reason, cutoffs[reason]);
          return `("reason" = $${bindings.length - 1} AND "created_time" < $${bindings.length})`;
        });
        const rows = (await this.unwrapClient(client).$queryRawUnsafe(
          `SELECT count(*)::text AS "count" FROM "record_trash"
             WHERE "table_id" = ANY($1::text[]) AND (${reasonPredicates.join(' OR ')})`,
          ...bindings
        )) as { count: string }[];
        backlog += Number(rows[0]?.count ?? '0');
      } catch (error) {
        // a progress reading must never fail a flush that already succeeded
        this.logger.warn(
          `removal cold flush backlog count skipped for ${group.spaceId ?? 'shared'}: ${error}`
        );
      }
    }
    if (backlog > 0) {
      this.logger.log(`record-removal cold flush backlog: ${backlog} archivable row(s) remain`);
    }
    return backlog;
  }

  // flush one discovered group as (table, reason) work items slice-by-slice
  // under the shared row/byte budget (soft, checked between slices: an
  // oversized single item still completes atomically); returns how many items
  // were deferred to the next run
  private async flushGroup(
    group: IDiscoveredGroup,
    results: ITableFlushResult[],
    budget: { flushedRows: number; flushedBytes: number; maxRows: number; maxBytes: number },
    run: {
      cutoffs: Record<ColdRemovalReason, Date>;
      mode: 'incremental' | 'backfill';
      deleteEnabled: boolean;
      concurrency: number;
      config: ReturnType<typeof recordRemovalColdConfig>;
      sortBudget: SortMemoryBudget;
    }
  ): Promise<number> {
    // both reasons of a table may run in the same slice: they touch disjoint
    // buffer predicates, S3 prefixes and stats files
    const items: IFlushWorkItem[] = group.tableIds.flatMap((tableId) =>
      COLD_REMOVAL_REASONS.map((reason) => ({ tableId, reason, cutoff: run.cutoffs[reason] }))
    );
    let index = 0;
    while (index < items.length) {
      // rows AND bytes: a payload spike trips the byte budget while barely moving rows
      if (
        (budget.maxRows > 0 && budget.flushedRows >= budget.maxRows) ||
        (budget.maxBytes > 0 && budget.flushedBytes >= budget.maxBytes)
      ) {
        return items.length - index;
      }
      const slice = items.slice(index, index + run.concurrency);
      index += slice.length;
      const sliceResults = await mapWithConcurrency(slice, run.concurrency, (item) =>
        this.flushTable(
          item.tableId,
          item.reason,
          item.cutoff,
          run.mode,
          run.deleteEnabled,
          run.config,
          run.sortBudget
        ).catch((error): ITableFlushResult => {
          this.logger.error(
            `removal cold flush failed for table ${item.tableId} reason ${item.reason}: ${error instanceof Error ? error.stack : error}`
          );
          return {
            tableId: item.tableId,
            reason: item.reason,
            rows: 0,
            parts: 0,
            uncompressedBytes: 0,
            compressedBytes: 0,
            deletedRows: 0,
            reconciledRows: 0,
            truncatedRows: 0,
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
      budget.flushedBytes += sliceResults.reduce((sum, item) => sum + item.uncompressedBytes, 0);
    }
    return 0;
  }

  // bookmark writes are monotonic: a manual run with a wide horizon override
  // computes an older cutoff and must not regress the high-water mark (a
  // regressed bookmark only costs an extra reconnect, but staying monotonic
  // keeps "everything at or before the bookmark is flushed" trivially true)
  private async advanceBookmark(bindingId: string, cutoff: Date): Promise<void> {
    await this.prismaService.spaceDataDbBinding.updateMany({
      where: {
        id: bindingId,
        OR: [{ lastRemovalFlushedAt: null }, { lastRemovalFlushedAt: { lt: cutoff } }],
      },
      data: { lastRemovalFlushedAt: cutoff },
    });
  }

  // discovery: the shared data db always participates (it is the always-on
  // main data db; a space filter narrows its tables rather than skipping it —
  // shared-storage spaces are valid targets too); BYODB dbs only when the
  // meta-side activity signal moved past the bookmark
  private async discoverGroups(
    options: IColdFlushOptions,
    cutoffs: Record<ColdRemovalReason, Date>,
    orphanCleanup: IOrphanCleanup
  ): Promise<IDiscoveredGroup[]> {
    const groups: IDiscoveredGroup[] = [];

    const sharedTables = await this.listBufferedTables(this.metaFallbackDataPrismaService);
    const shared = await this.filterKnownTables(sharedTables, {
      excludeByodbBound: true,
      ...(options.spaceIds?.length ? { spaceIds: options.spaceIds } : undefined),
    });
    if (shared.keep.length) {
      groups.push({ kind: 'shared', tableIds: shared.keep });
    }
    if (orphanCleanup.enabled && shared.orphans.length) {
      orphanCleanup.deletedRows += await this.deleteOrphanBufferRows(
        this.metaFallbackDataPrismaService,
        shared.orphans,
        cutoffs.archived
      );
    }

    const bindings = await this.prismaService.spaceDataDbBinding.findMany({
      where: {
        mode: 'byodb',
        state: 'ready',
        ...(options.spaceIds?.length ? { spaceId: { in: options.spaceIds } } : {}),
      },
      select: { id: true, spaceId: true, lastRemovalFlushedAt: true },
    });
    const activeBindings = options.ignoreBookmarks
      ? bindings
      : await this.filterActiveBindings(bindings);

    for (const binding of activeBindings) {
      const group = await this.discoverBindingGroup(binding, cutoffs, orphanCleanup);
      if (group) groups.push(group);
    }

    return groups;
  }

  // one grouped aggregate over table_meta replaces a per-binding max() query;
  // bindings with no record activity since their last flush are pruned here so
  // discoverBindingGroup never connects to them (keeps idle dbs asleep)
  private async filterActiveBindings<
    TBinding extends { spaceId: string; lastRemovalFlushedAt: Date | null },
  >(bindings: TBinding[]): Promise<TBinding[]> {
    if (!bindings.length) return bindings;
    const rows = await this.prismaService.$queryRaw<
      { spaceId: string; maxModified: Date | null }[]
    >`SELECT b.space_id AS "spaceId", max(tm.last_modified_time) AS "maxModified"
      FROM table_meta tm JOIN base b ON b.id = tm.base_id
      WHERE b.space_id IN (${Prisma.join(bindings.map((binding) => binding.spaceId))})
      GROUP BY b.space_id`;
    const maxModifiedBySpace = new Map(rows.map((row) => [row.spaceId, row.maxModified]));
    return bindings.filter((binding) => {
      if (!binding.lastRemovalFlushedAt) return true;
      const maxModified = maxModifiedBySpace.get(binding.spaceId);
      return !!maxModified && maxModified > binding.lastRemovalFlushedAt;
    });
  }

  private async discoverBindingGroup(
    binding: { id: string; spaceId: string },
    cutoffs: Record<ColdRemovalReason, Date>,
    orphanCleanup: IOrphanCleanup
  ): Promise<IDiscoveredGroup | undefined> {
    try {
      const client = await this.dataDbClientManager.dataPrismaForSpace(binding.spaceId);
      const tableIds = await this.listBufferedTables(client);
      const filtered = await this.filterKnownTables(tableIds);
      // the tenant db is already awake here, so cleaning its own orphans (rows
      // of tables deleted inside this tenant) costs nothing extra and never
      // wakes an idle db on its own
      if (orphanCleanup.enabled && filtered.orphans.length) {
        orphanCleanup.deletedRows += await this.deleteOrphanBufferRows(
          client,
          filtered.orphans,
          cutoffs.archived
        );
      }
      if (filtered.keep.length) {
        return {
          kind: 'byodb',
          spaceId: binding.spaceId,
          bindingId: binding.id,
          tableIds: filtered.keep,
        };
      }
      // nothing buffered: still advance the bookmark (to the archived cutoff,
      // matching what a flush would have covered) so quiet dbs stay skipped
      await this.advanceBookmark(binding.id, cutoffs.archived).catch(() => undefined);
    } catch (error) {
      this.logger.warn(`removal cold flush discovery skipped space ${binding.spaceId}: ${error}`);
    }
    return undefined;
  }

  // loose index scan: distinct table_id from the buffer at O(#tables × log n)
  private async listBufferedTables(client: unknown): Promise<string[]> {
    const prisma = this.unwrapClient(client);
    const rows = (await prisma.$queryRawUnsafe(
      `WITH RECURSIVE distinct_tables AS (
         SELECT min(table_id) AS table_id FROM record_trash
         UNION ALL
         SELECT (SELECT min(r.table_id) FROM record_trash r WHERE r.table_id > d.table_id)
         FROM distinct_tables d WHERE d.table_id IS NOT NULL
       )
       SELECT table_id AS "tableId" FROM distinct_tables WHERE table_id IS NOT NULL`
    )) as { tableId: string }[];
    return rows.map((row) => row.tableId);
  }

  // drop buffer rows of deleted/unknown tables from the work list (abandoned
  // copies); for the shared group also drop every table whose space has a
  // non-default binding, REGARDLESS of state — this must mirror the
  // DatabaseRouter exactly, which never falls back to the shared db for
  // mode='byodb' (ready/migrating/error route to the tenant connection,
  // anything else throws). Flushing a shared-db copy the router would not
  // serve corrupts an active migration's row-count checks (copy/validate),
  // and for error/disabled it would operate on the wrong database entirely.
  // Those rows simply wait untiered until the binding is repaired or reset.
  private async filterKnownTables(
    tableIds: string[],
    options?: { excludeByodbBound?: boolean; spaceIds?: string[] }
  ): Promise<{ keep: string[]; orphans: string[] }> {
    if (!tableIds.length) return { keep: [], orphans: [] };
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
    // An orphan is a buffered table_id with NO table_meta row anywhere: the
    // table was hard-deleted, so its trash is unreachable by every reader
    // (trash/archive reads need a live table) AND by normal flushing
    // (discovery is table_meta-driven), leaving it stranded in the buffer
    // forever. This is DISTINCT from a byodb-routed table, which keeps its
    // table_meta and is merely served from another db — those are never
    // orphaned or deleted here. A space-scoped run filters `known`, so
    // re-check existence unfiltered to avoid misclassifying an other-space
    // table as an orphan.
    const existingIds = options?.spaceIds?.length
      ? new Set(
          (
            await this.prismaService.tableMeta.findMany({
              where: { id: { in: tableIds } },
              select: { id: true },
            })
          ).map((table) => table.id)
        )
      : new Set(known.map((table) => table.id));
    const orphans = tableIds.filter((id) => !existingIds.has(id));
    const servedElsewhere = tableIds.filter((id) => existingIds.has(id) && !keepSet.has(id));
    if (servedElsewhere.length) {
      this.logger.warn(
        `removal cold flush skipping ${servedElsewhere.length} buffered table(s) served elsewhere (byodb/out-of-scope): ${servedElsewhere.slice(0, 5).join(',')}`
      );
    }
    return { keep: tableIds.filter((id) => keepSet.has(id)), orphans };
  }

  // Map a buffer row to a cold row and cap its snapshot. Truncation is
  // JS-side for v1: unlike record-history's two scalar columns the snapshot
  // is one JSON document, and SQL-side JSON truncation is not worth the
  // complexity — so an oversized snapshot DOES cross the wire and briefly
  // lives on the heap before the cap replaces it. rawBytes is therefore the
  // PRE-truncation size: the adaptive batch limit must bound what the wire
  // delivers, not what survives the cap.
  private buildColdRow(
    reason: ColdRemovalReason,
    row: {
      id: string;
      recordId: string;
      snapshot: string;
      createdTime: string;
      createdBy: string;
      operationId: string | null;
      recordCreatedTime: string | null;
      recordCreatedBy: string | null;
      recordLastModifiedTime: string | null;
      recordLastModifiedBy: string | null;
    },
    config: ReturnType<typeof recordRemovalColdConfig>
  ): { row: IColdRemovalRow; truncatedCount: number; rawBytes: number } {
    const raw: IColdRemovalRow = {
      id: row.id,
      recordId: row.recordId,
      snapshot: row.snapshot,
      reason,
      removedTime: row.createdTime,
      removedBy: row.createdBy,
      operationId: row.operationId ?? undefined,
      recordCreatedTime: row.recordCreatedTime ?? undefined,
      recordCreatedBy: row.recordCreatedBy ?? undefined,
      recordLastModifiedTime: row.recordLastModifiedTime ?? undefined,
      recordLastModifiedBy: row.recordLastModifiedBy ?? undefined,
    };
    const rawBytes = approxRemovalRowBytes(raw);
    const capped = truncateRemovalRow(raw, config.truncateFieldUnits, config.truncateRowUnits);
    return { row: capped, truncatedCount: capped !== raw ? 1 : 0, rawBytes };
  }

  async flushTable(
    tableId: string,
    reason: ColdRemovalReason,
    cutoff: Date,
    mode: 'incremental' | 'backfill',
    deleteEnabled: boolean,
    config = recordRemovalColdConfig(),
    sortBudget = new SortMemoryBudget(config.sortMemoryBudgetBytes)
  ): Promise<ITableFlushResult> {
    const startedAt = Date.now();
    const qualified = await this.qualifiedTrashTable(tableId);
    const dayWindowStart = new Date(Date.now() - config.backfillDayWindowMs);

    // buckets whose rows are already fully persisted (stats corroborated by a
    // live part listing) skip the merge-rewrite entirely — the "upload-only →
    // delete-enabled" transition then reconciles and deletes without redoing
    // any upload work
    const coverage = await this.planBucketCoverage(
      tableId,
      reason,
      qualified,
      cutoff,
      dayWindowStart
    );

    const feeders = new Map<string, BucketMergeFeeder>();
    // bucketing is date-based regardless of mode: a steady-state daily run
    // only ever sees young-side rows (day files), while the very first run
    // after an upgrade sees the whole historical backlog and lands it directly
    // as month files — a zero-ops instance gets the backfill layout for free

    const monthParts = new Map<
      string,
      Awaited<ReturnType<RecordRemovalColdStorageService['listMonthParts']>>
    >();
    const feederFor = async (removedTime: string): Promise<BucketMergeFeeder> => {
      const removed = new Date(removedTime);
      const kind = removed >= dayWindowStart ? 'day' : 'month';
      const bucket: IPartBucket = bucketOfDate(removed, kind);
      const id = bucketId(bucket);
      let feeder = feeders.get(id);
      if (!feeder) {
        // a bucket may already hold parts from an earlier run whose buffer
        // rows were deleted since — those must be merged back in, not clobbered
        let parts = monthParts.get(bucket.yyyymm);
        if (!parts) {
          parts = await this.coldStorage.listMonthParts(tableId, reason, bucket.yyyymm);
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
          reason,
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
          config.truncateFieldUnits,
          config.truncateRowUnits
        );
        feeders.set(id, feeder);
      }
      return feeder;
    };

    let flushedRows = 0;
    let truncatedRows = 0;
    let lastKey: { createdTime: Date; id: string } | undefined;
    const streamNothing = coverage.streamRanges !== undefined && coverage.streamRanges.length === 0;
    let batchLimit = Math.min(READ_BATCH_PROBE_ROWS, config.readBatchSize);
    const allEntries: IPartStatsEntry[] = [];
    const touched = new Map<string, ITouchedBucket>();
    try {
      while (!streamNothing) {
        const batch = await this.readBatch(
          tableId,
          reason,
          qualified,
          cutoff,
          batchLimit,
          lastKey,
          coverage.streamRanges
        );
        if (batch.length === 0) break;
        const last = batch[batch.length - 1];
        lastKey = { createdTime: new Date(last.createdTime), id: last.id };
        let batchBytes = 0;
        for (let i = 0; i < batch.length; i++) {
          const built = this.buildColdRow(reason, batch[i], config);
          batchBytes += built.rawBytes;
          truncatedRows += built.truncatedCount;
          // drop the source row's reference as we go: with multi-MB rows the
          // whole batch array would otherwise stay live until the loop ends
          (batch as unknown as (unknown | undefined)[])[i] = undefined;
          await (await feederFor(built.row.removedTime)).push(built.row);
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
      await this.updateStats(tableId, reason, touched, allEntries);
    }

    let deletedRows = 0;
    let deleteSkippedReason: string | undefined;
    if (deleteEnabled && flushedRows + coverage.coveredRows > 0) {
      const outcome = await this.reconcileAndDelete(
        tableId,
        reason,
        qualified,
        cutoff,
        flushedRows + coverage.coveredRows
      );
      deletedRows = outcome.deletedRows;
      deleteSkippedReason = outcome.skippedReason;
    }

    return {
      tableId,
      reason,
      rows: flushedRows,
      parts: metrics.parts,
      uncompressedBytes: metrics.uncompressedBytes,
      compressedBytes: metrics.compressedBytes,
      deletedRows,
      deleteSkippedReason,
      reconciledRows: coverage.coveredRows,
      truncatedRows,
      durationMs: Date.now() - startedAt,
    };
  }

  // Coverage plan for the "upload-only → delete-enabled" transition (and for
  // idempotent re-runs): a bucket whose buffer rows are ALREADY fully
  // persisted skips the merge-rewrite. "Fully persisted" is judged by an
  // exact triple match — row count and min/max created_time — between the
  // buffer's per-bucket aggregate and the bucket's stats entries, AND a
  // live listing that corroborates the stats keys one-to-one (stats alone
  // are advisory; skipping an upload on stale stats would lose rows at the
  // delete step). Buffer rows are insert-only with db-stamped timestamps and
  // uploads came from this very buffer, so a triple match implies set
  // equality for our write pattern.
  //
  // Returns the rows covered this way plus the canonical time ranges of the
  // NON-covered buckets to stream (undefined = stream everything; [] =
  // nothing left to stream).
  private async planBucketCoverage(
    tableId: string,
    reason: ColdRemovalReason,
    qualified: string,
    cutoff: Date,
    dayWindowStart: Date
  ): Promise<{ coveredRows: number; streamRanges?: { lo: Date; hi: Date }[] }> {
    const noCoverage = { coveredRows: 0, streamRanges: undefined };
    const buckets = (await this.databaseRouter.queryDataPrismaForTable(
      tableId,
      `SELECT to_char("created_time", 'YYYYMM') AS "yyyymm",
         CASE WHEN "created_time" >= $4 THEN to_char("created_time", 'DD') END AS "dd",
         count(*)::text AS "count",
         min("created_time") AS "min", max("created_time") AS "max"
       FROM ${qualified}
       WHERE "table_id" = $1 AND "reason" = $2 AND "created_time" < $3
       GROUP BY 1, 2`,
      tableId,
      reason,
      cutoff,
      dayWindowStart
    )) as { yyyymm: string; dd: string | null; count: string; min: Date; max: Date }[];
    if (buckets.length === 0) {
      return { coveredRows: 0, streamRanges: [] };
    }

    const stats = await this.coldStorage.readStats(tableId, reason);
    if (!stats) return noCoverage;

    const statsByBucket = this.groupStatsByBucket(stats);
    const listedByBucket = await this.listPartsByBucket(tableId, reason, [
      ...new Set(buckets.map((bucket) => bucket.yyyymm)),
    ]);

    let coveredRows = 0;
    const streamRanges: { lo: Date; hi: Date }[] = [];
    for (const bucket of buckets) {
      const id = bucket.dd ? `${bucket.yyyymm}/${bucket.dd}` : `${bucket.yyyymm}/m`;
      if (isBucketCovered(statsByBucket.get(id), listedByBucket.get(id), bucket)) {
        coveredRows += Number(bucket.count);
      } else {
        streamRanges.push(bucketRange(bucket, cutoff, dayWindowStart));
      }
    }

    if (coveredRows === 0) return noCoverage;
    if (streamRanges.length > 64) {
      this.logger.warn(
        `removal cold flush coverage: ${streamRanges.length} uncovered bucket(s) exceed the predicate cap; falling back to a full rewrite for ${tableId}/${reason}`
      );
      return noCoverage;
    }
    return { coveredRows, streamRanges };
  }

  private groupStatsByBucket(stats: ITableColdStats) {
    return groupStatsByBucket(
      stats.parts,
      (key) => {
        const parsed = parsePartKey(this.coldStorage.rootDir, key);
        return parsed ? bucketId(parsed) : undefined;
      },
      (entry) => ({ min: entry.minRemovedTime, max: entry.maxRemovedTime })
    );
  }

  private async listPartsByBucket(tableId: string, reason: ColdRemovalReason, months: string[]) {
    const byBucket = new Map<string, Set<string>>();
    for (const yyyymm of months) {
      for (const part of await this.coldStorage.listMonthParts(tableId, reason, yyyymm)) {
        const id = bucketId(part);
        const set = byBucket.get(id) ?? new Set<string>();
        set.add(part.key);
        byBucket.set(id, set);
      }
    }
    return byBucket;
  }

  private async qualifiedTrashTable(tableId: string): Promise<string> {
    const url = await this.dataDbClientManager.getDataDatabaseUrlForTable(tableId);
    const schema = new URL(url).searchParams.get('schema') || 'public';
    return `${quoteIdent(schema)}."record_trash"`;
  }

  private async readBatch(
    tableId: string,
    reason: ColdRemovalReason,
    qualified: string,
    cutoff: Date,
    limit: number,
    after?: { createdTime: Date; id: string },
    ranges?: { lo: Date; hi: Date }[]
  ) {
    // Read on the table's own pg connection via the NATIVE pg client (knex /
    // node-postgres), routed per-table by withDataKnexConnectionForTable
    // exactly as the Prisma path would be — a BYODB table hits the tenant DB
    // over its own leased connection, a shared table the main DB. (The bare
    // dataKnexForTable handle is compiler-only: it always executes on the
    // main pool, so a tenant-qualified query would run on the wrong db.) The
    // native driver (rather than Prisma) mirrors record-history, whose rust
    // engine deterministically failed on one shared-DB table with "Failed to
    // convert rust String into napi string" for valid sub-cap UTF-8.
    const bindings: unknown[] = [];
    // positional binds are consumed left-to-right, so emit them in SQL order
    const bind = (value: unknown) => {
      bindings.push(value);
      return '?';
    };
    // created_time is TIMESTAMP without time zone storing UTC. node-postgres
    // binds a Date using the process timezone, so pass UTC naive strings (and
    // read the columns back as UTC ISO strings below) to keep the predicate
    // window identical on any deployment TZ.
    const bindTs = (value: Date) => `${bind(value.toISOString().slice(0, -1))}::timestamp`;
    const tableIdBind = bind(tableId);
    const reasonBind = bind(reason);
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
      afterClause = ` AND ("created_time", "id" COLLATE "C") > (${bindTs(after.createdTime)}, ${bind(after.id)})`;
    }
    // keyset order is the removal main order (removedTime-major); the id
    // tiebreak pins COLLATE "C" so the paging comparison and the ORDER BY
    // agree byte-for-byte with the JS comparator, never a db collation
    const utcIso = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
    const sql = `SELECT "id", "record_id" AS "recordId", "snapshot",
         to_char("created_time", ${utcIso}) AS "createdTime",
         "created_by" AS "createdBy",
         "operation_id" AS "operationId",
         to_char("record_created_time", ${utcIso}) AS "recordCreatedTime",
         "record_created_by" AS "recordCreatedBy",
         to_char("record_last_modified_time", ${utcIso}) AS "recordLastModifiedTime",
         "record_last_modified_by" AS "recordLastModifiedBy"
       FROM ${qualified}
       WHERE "table_id" = ${tableIdBind} AND "reason" = ${reasonBind} AND "created_time" < ${cutoffBind}${rangeClause}${afterClause}
       ORDER BY "created_time" ASC, "id" COLLATE "C" ASC LIMIT ${Math.max(1, Math.floor(limit))}`;
    const result = await this.dataDbClientManager.withDataKnexConnectionForTable(
      tableId,
      (knex, connection) => knex.raw(sql, bindings).connection(connection)
    );
    return ((result as { rows?: unknown[] }).rows ?? (result as unknown[])) as Array<{
      id: string;
      recordId: string;
      snapshot: string;
      createdTime: string;
      createdBy: string;
      operationId: string | null;
      recordCreatedTime: string | null;
      recordCreatedBy: string | null;
      recordLastModifiedTime: string | null;
      recordLastModifiedBy: string | null;
    }>;
  }

  // deterministic self-healing, scoped to what this run actually superseded:
  // only the pre-existing keys the bucket feeder folded into its rewrite may
  // be deleted. A same-bucket key that appeared after the feeder's listing
  // belongs to a concurrent flush (manual/catch-up overlapping the daily job)
  // and must survive — read-side id-dedup absorbs the temporary duplication.
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
      this.logger.warn(
        `removal cold flush healing ${staleKeys.length} superseded part(s) for ${tableId}`
      );
      await this.coldStorage.deleteKeys(staleKeys);
    }
  }

  private async updateStats(
    tableId: string,
    reason: ColdRemovalReason,
    touched: Map<string, ITouchedBucket>,
    entries: IPartStatsEntry[]
  ): Promise<void> {
    const stats: ITableColdStats = (await this.coldStorage.readStats(tableId, reason)) ?? {
      version: 1,
      tableId,
      reason,
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
    await this.coldStorage.writeStats(tableId, reason, stats);
  }

  // range delete with a count reconciliation latch: the cutoff was pinned at
  // run start and created_time is stamped by the db at insert, so the set
  // "rows < cutoff" is stable — unless a straggler write slipped in after the
  // read. The count check catches exactly that case and defers deletion to
  // the next run instead of losing rows.
  private async reconcileAndDelete(
    tableId: string,
    reason: ColdRemovalReason,
    qualified: string,
    cutoff: Date,
    flushedRows: number
  ): Promise<{ deletedRows: number; skippedReason?: string }> {
    const countRows = (await this.databaseRouter.queryDataPrismaForTable(
      tableId,
      `SELECT count(*)::text AS "count" FROM ${qualified} WHERE "table_id" = $1 AND "reason" = $2 AND "created_time" < $3`,
      tableId,
      reason,
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
      return {
        deletedRows: await this.deleteFlushedRows(tableId, reason, qualified, cutoff, flushedRows),
      };
    } catch (error) {
      // serialization failure or timeout: rows stay buffered, next run retries
      return {
        deletedRows: 0,
        skippedReason: `delete-deferred: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  // snapshot-consistent delete: count and delete run inside one REPEATABLE
  // READ transaction, so a trash row whose transaction opened before the
  // cutoff but commits between the two statements is invisible to the delete
  // and survives for the next run — the range predicate alone would remove it
  // without it ever having been uploaded. (This is why the delete is NOT split
  // into separately-committed batches: a fresh snapshot per batch would see
  // such a late row and delete it un-uploaded. The single-statement DELETE is
  // also one O(n) index pass — record-history's earlier ctid-LIMIT batching
  // loop re-scanned not-yet-vacuumable dead tuples every iteration, O(n^2),
  // and timed out the 30-min transaction on 10M+ row tables, the 2026-07-09
  // cn stall.) A table beyond a few tens of millions of cold rows can still
  // exceed the timeout; it then defers to the next run rather than crashing.
  private async deleteFlushedRows(
    tableId: string,
    reason: ColdRemovalReason,
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
          `SELECT count(*)::int AS "count" FROM ${qualified} WHERE "table_id" = $1 AND "reason" = $2 AND "created_time" < $3`,
          tableId,
          reason,
          cutoff
        )) as { count: number }[];
        const count = Number(countRows[0]?.count ?? 0);
        if (count !== expectedRows) {
          throw new Error(
            `snapshot count ${count} != flushed ${expectedRows}; rows changed since reconciliation`
          );
        }
        return await tx.$executeRawUnsafe(
          `DELETE FROM ${qualified} WHERE "table_id" = $1 AND "reason" = $2 AND "created_time" < $3`,
          tableId,
          reason,
          cutoff
        );
      },
      { isolationLevel: 'RepeatableRead', timeout: 30 * 60_000, maxWait: 30_000 }
    );
  }

  // Delete buffered trash of hard-deleted tables (no table_meta row) from the
  // db that holds it. Unlike a live table these rows can never be tiered:
  // normal flushing discovers work through table_meta, so it can neither
  // upload nor delete them, and they pile up in the buffer forever. Dropping
  // them loses nothing readable — trash/archive reads need a live table — so
  // there is no cold part to write first.
  //
  // The delete runs on the SAME client that listed the rows (a deleted table
  // has no metadata to route through dataPrismaForTable), addressing
  // record_trash unqualified exactly like listBufferedTables so it lands on
  // that client's search_path. No reason predicate: BOTH reasons of an
  // unreachable table are garbage. Bounded by the ARCHIVED cutoff (the newer
  // one) so a table only momentarily missing from table_meta
  // (mid-create/restore) keeps its recent rows; callers gate this on
  // deleteEnabled, so a read-only environment sharing the db never mutates it.
  private async deleteOrphanBufferRows(
    client: unknown,
    orphanTableIds: string[],
    cutoff: Date
  ): Promise<number> {
    if (!orphanTableIds.length) return 0;
    try {
      const prisma = this.unwrapClient(client);
      const deleted = Number(
        await prisma.$executeRawUnsafe(
          `DELETE FROM "record_trash" WHERE "table_id" = ANY($1::text[]) AND "created_time" < $2`,
          orphanTableIds,
          cutoff
        )
      );
      if (deleted > 0) {
        this.logger.log(
          `removal cold flush deleted ${deleted} orphan buffer row(s) from ${orphanTableIds.length} deleted table(s): ${orphanTableIds.slice(0, 5).join(',')}`
        );
      }
      return deleted;
    } catch (error) {
      // orphan cleanup runs in discovery, before any live table is flushed, so
      // an unbounded delete that hits a lock or the statement/transaction
      // timeout on a large deleted-table backlog must NOT escape and abort the
      // whole run — a per-table flush failure is merely deferred to a result,
      // and one stuck orphan set must not stall otherwise-healthy tables. Log
      // and move on; the orphans stay put and are retried next run.
      this.logger.warn(
        `removal cold flush orphan cleanup failed for ${orphanTableIds.length} table(s) (${orphanTableIds.slice(0, 5).join(',')}): ${error instanceof Error ? error.message : String(error)}`
      );
      return 0;
    }
  }

  private unwrapClient(client: unknown): {
    $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
    $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  } {
    const candidate = client as {
      txClient?: () => unknown;
      $queryRawUnsafe?: (query: string, ...values: unknown[]) => Promise<unknown>;
      $executeRawUnsafe?: (query: string, ...values: unknown[]) => Promise<number>;
    };
    if (typeof candidate.txClient === 'function') {
      return candidate.txClient() as ReturnType<RecordRemovalFlusherService['unwrapClient']>;
    }
    return candidate as ReturnType<RecordRemovalFlusherService['unwrapClient']>;
  }
}
