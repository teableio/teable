import { Injectable, Logger } from '@nestjs/common';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import {
  planMonthCompaction,
  supersededKeys,
  swapCompactedStatsEntries,
} from '../cold-archive/compaction';
import { ExternalRowSorter, SortMemoryBudget } from './external-sort';
import { COLD_REMOVAL_REASONS, truncateRemovalRow } from './part-codec';
import type { ColdRemovalReason, IParsedPartKey, ITableColdStats } from './part-codec';
import { PartWriter } from './part-writer';
import { RecordRemovalColdStorageService } from './record-removal-cold-storage.service';
import { recordRemovalColdConfig } from './record-removal-cold.config';
import type { IRemovalTombstoneMap } from './record-removal-tombstone.service';
import { isTombstonedAt, RecordRemovalTombstoneService } from './record-removal-tombstone.service';

export interface ICompactMonthResult {
  tableId: string;
  reason: ColdRemovalReason;
  yyyymm: string;
  inputParts: number;
  outputParts: number;
  rows: number;
  // tombstoned rows physically dropped from the rewritten month parts
  tombstonedRows: number;
  skippedReason?: string;
  durationMs: number;
}

// Merges the day parts of one (table, reason, month) — plus any existing
// month parts, so late flushes after a previous compaction fold in — into
// fresh month parts, deduplicated by row id and canonically ordered via an
// external sort. Input parts are read sequentially to EOF and NO input
// ordering is assumed, which also makes compaction the repair tool for parts
// written under a mismatched order. Idempotent: healing removes every key of
// the month not written by the final run, and the read path dedups by id
// during any transition window.
//
// Tombstone filtering: the month rewrite is where restored/purged rows get
// physically dropped from the parts (readers already filter them; this
// reclaims the bytes and rebuilds stats/bloom without them). Tombstone rows
// are NOT deleted afterwards — day parts of the current month or other months
// may still hold copies of the same record, and only the tombstone keeps them
// invisible. GC needs an "every part of the table confirmed clean" check;
// deferred (the tombstone table stays tiny, see the tombstone service).
@Injectable()
export class RecordRemovalCompactorService {
  private readonly logger = new Logger(RecordRemovalCompactorService.name);

  constructor(
    private readonly coldStorage: RecordRemovalColdStorageService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly tombstoneService: RecordRemovalTombstoneService
  ) {}

  // compact every closed month of a table, both reason prefixes; the current
  // (still-hot) month is skipped
  async compactTable(tableId: string): Promise<ICompactMonthResult[]> {
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const results: ICompactMonthResult[] = [];
    for (const reason of COLD_REMOVAL_REASONS) {
      const months = await this.coldStorage.listMonths(tableId, reason);
      for (const yyyymm of months) {
        if (yyyymm >= currentMonth) continue;
        results.push(await this.compactMonth(tableId, reason, yyyymm));
      }
    }
    return results;
  }

  async compactMonth(
    tableId: string,
    reason: ColdRemovalReason,
    yyyymm: string,
    options?: { force?: boolean }
  ): Promise<ICompactMonthResult> {
    const startedAt = Date.now();
    const config = recordRemovalColdConfig();
    const parts = await this.coldStorage.listMonthParts(tableId, reason, yyyymm);
    const plan = planMonthCompaction(parts, options);

    const base: Omit<ICompactMonthResult, 'skippedReason'> = {
      tableId,
      reason,
      yyyymm,
      inputParts: plan.inputParts,
      outputParts: 0,
      rows: 0,
      tombstonedRows: 0,
      durationMs: 0,
    };
    if (plan.skippedReason) {
      return { ...base, durationMs: Date.now() - startedAt, skippedReason: plan.skippedReason };
    }

    const tombstones = await this.loadTombstones(tableId);
    const { inputs, startSeq } = plan;
    const writer = new PartWriter({
      store: this.coldStorage.partStore,
      rootDir: this.coldStorage.rootDir,
      tableId,
      reason,
      bucket: { yyyymm, kind: 'month' },
      partUncompressedBytes: config.partUncompressedBytes,
      startSeq,
    });

    const { rows, tombstonedRows } = await this.mergeInputs(
      inputs,
      writer,
      tombstones,
      new SortMemoryBudget(config.sortMemoryBudgetBytes),
      config.sortMergeFanIn,
      config.truncateFieldUnits,
      config.truncateRowUnits
    );
    const entries = await writer.finish();

    const stats: ITableColdStats = (await this.coldStorage.readStats(tableId, reason)) ?? {
      version: 1,
      tableId,
      reason,
      parts: {},
    };
    swapCompactedStatsEntries(stats.parts, inputs, entries);
    await this.coldStorage.writeStats(tableId, reason, stats);

    const staleKeys = supersededKeys(inputs, entries);
    await this.coldStorage.deleteKeys(staleKeys);

    this.logger.log(
      `compacted ${tableId}/${reason}/${yyyymm}: ${inputs.length} part(s) -> ${entries.length}, rows=${rows}` +
        (tombstonedRows ? `, tombstoned=${tombstonedRows} dropped` : '')
    );
    return {
      ...base,
      outputParts: entries.length,
      rows,
      tombstonedRows,
      durationMs: Date.now() - startedAt,
    };
  }

  // Tombstones live in the table's data db (next to record_trash). Loading
  // fails open to an empty map: dropping tombstoned rows is a space
  // optimization — readers filter them regardless — so an unreachable tenant
  // db (or a table hard-deleted with cold data left behind) must not fail the
  // month merge; the next compaction retries the drop.
  private async loadTombstones(tableId: string): Promise<IRemovalTombstoneMap> {
    try {
      const dataPrisma = await this.dataDbClientManager.dataPrismaForTable(tableId);
      return await this.tombstoneService.loadTombstonedRecordIds(dataPrisma, tableId);
    } catch (error) {
      this.logger.warn(
        `tombstone load failed for ${tableId}; compacting without the drop: ${error instanceof Error ? error.message : error}`
      );
      return new Map();
    }
  }

  // external sort + id-dedup: inputs are read one at a time, order-agnostic
  private async mergeInputs(
    inputs: IParsedPartKey[],
    writer: PartWriter,
    tombstones: IRemovalTombstoneMap,
    sortBudget: SortMemoryBudget,
    mergeFanIn: number,
    truncateFieldUnits: number,
    truncateRowUnits: number
  ): Promise<{ rows: number; tombstonedRows: number }> {
    // one sorter per month here (months compact serially), but a fat-row
    // month can still out-weigh the 50k row cap — the byte budget bounds it
    const sorter = new ExternalRowSorter(undefined, sortBudget, mergeFanIn);
    let tombstonedRows = 0;
    try {
      for (const input of inputs) {
        for await (const item of this.coldStorage.iterateRows(input.key)) {
          if (!item.row) continue;
          // physical tombstone drop: restored/purged rows never reach the
          // rewritten parts, so stats/bloom rebuild without them for free
          if (isTombstonedAt(tombstones, item.row.recordId, item.row.removedTime)) {
            tombstonedRows += 1;
            continue;
          }
          // heal legacy oversized snapshots as month parts are rewritten
          await sorter.add(
            truncateFieldUnits || truncateRowUnits
              ? truncateRemovalRow(item.row, truncateFieldUnits, truncateRowUnits)
              : item.row
          );
        }
      }
      let rows = 0;
      await sorter.drainTo(async (row) => {
        await writer.add(row);
        rows += 1;
      });
      return { rows, tombstonedRows };
    } finally {
      await sorter.cleanup();
    }
  }
}
