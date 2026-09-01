import { Injectable, Logger } from '@nestjs/common';
import {
  planMonthCompaction,
  supersededKeys,
  swapCompactedStatsEntries,
} from '../cold-archive/compaction';
import { ExternalRowSorter, SortMemoryBudget } from './external-sort';
import { truncateColdRow } from './part-codec';
import type { IParsedPartKey, ITableColdStats } from './part-codec';
import { PartWriter } from './part-writer';
import { RecordHistoryColdStorageService } from './record-history-cold-storage.service';
import { recordHistoryColdConfig } from './record-history-cold.config';

export interface ICompactMonthResult {
  tableId: string;
  yyyymm: string;
  inputParts: number;
  outputParts: number;
  rows: number;
  skippedReason?: string;
  durationMs: number;
}

/**
 * Merges the day parts of one month (plus any existing month parts, so late
 * flushes after a previous compaction fold in) into fresh month parts,
 * deduplicated by row id and byte-ordered via an external sort — input parts
 * are read sequentially to EOF and NO input ordering is assumed, which also
 * makes compaction the repair tool for parts written under a mismatched
 * (db-collation) order. Idempotent: healing removes every key of the month
 * not written by the final run, and the read path dedups by id during any
 * transition window.
 */
@Injectable()
export class RecordHistoryCompactorService {
  private readonly logger = new Logger(RecordHistoryCompactorService.name);

  constructor(private readonly coldStorage: RecordHistoryColdStorageService) {}

  /** compact every month of a table except the current (still-hot) one */
  async compactTable(tableId: string): Promise<ICompactMonthResult[]> {
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const months = await this.coldStorage.listMonths(tableId);
    const results: ICompactMonthResult[] = [];
    for (const yyyymm of months) {
      if (yyyymm >= currentMonth) continue;
      results.push(await this.compactMonth(tableId, yyyymm));
    }
    return results;
  }

  async compactMonth(
    tableId: string,
    yyyymm: string,
    options?: { force?: boolean }
  ): Promise<ICompactMonthResult> {
    const startedAt = Date.now();
    const config = recordHistoryColdConfig();
    const parts = await this.coldStorage.listMonthParts(tableId, yyyymm);
    const plan = planMonthCompaction(parts, options);

    const base: Omit<ICompactMonthResult, 'skippedReason'> = {
      tableId,
      yyyymm,
      inputParts: plan.inputParts,
      outputParts: 0,
      rows: 0,
      durationMs: 0,
    };
    if (plan.skippedReason) {
      return { ...base, durationMs: Date.now() - startedAt, skippedReason: plan.skippedReason };
    }

    const { inputs, startSeq } = plan;
    const writer = new PartWriter({
      store: this.coldStorage.partStore,
      rootDir: this.coldStorage.rootDir,
      tableId,
      bucket: { yyyymm, kind: 'month' },
      partUncompressedBytes: config.partUncompressedBytes,
      startSeq,
    });

    const rows = await this.mergeInputs(
      inputs,
      writer,
      new SortMemoryBudget(config.sortMemoryBudgetBytes),
      config.sortMergeFanIn,
      config.truncateValueUnits
    );
    const entries = await writer.finish();

    const stats: ITableColdStats = (await this.coldStorage.readStats(tableId)) ?? {
      version: 1,
      tableId,
      parts: {},
    };
    swapCompactedStatsEntries(stats.parts, inputs, entries);
    await this.coldStorage.writeStats(tableId, stats);

    const staleKeys = supersededKeys(inputs, entries);
    await this.coldStorage.deleteKeys(staleKeys);

    this.logger.log(
      `compacted ${tableId}/${yyyymm}: ${inputs.length} part(s) -> ${entries.length}, rows=${rows}`
    );
    return {
      ...base,
      outputParts: entries.length,
      rows,
      durationMs: Date.now() - startedAt,
    };
  }

  /** external sort + id-dedup: inputs are read one at a time, order-agnostic */
  private async mergeInputs(
    inputs: IParsedPartKey[],
    writer: PartWriter,
    sortBudget: SortMemoryBudget,
    mergeFanIn: number,
    truncateValueUnits: number
  ): Promise<number> {
    // one sorter per month here (months compact serially), but a fat-row
    // month can still out-weigh the 50k row cap — the byte budget bounds it
    const sorter = new ExternalRowSorter(undefined, sortBudget, mergeFanIn);
    try {
      for (const input of inputs) {
        for await (const item of this.coldStorage.iterateRows(input.key)) {
          if (!item.row) continue;
          // heal legacy oversized values as month parts are rewritten
          await sorter.add(
            truncateValueUnits ? truncateColdRow(item.row, truncateValueUnits) : item.row
          );
        }
      }
      let rows = 0;
      await sorter.drainTo(async (row) => {
        await writer.add(row);
        rows += 1;
      });
      return rows;
    } finally {
      await sorter.cleanup();
    }
  }
}
