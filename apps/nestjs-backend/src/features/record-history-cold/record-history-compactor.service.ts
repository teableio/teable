import { Injectable, Logger } from '@nestjs/common';
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
    const dayParts = parts.filter((part) => part.kind === 'day');
    const monthParts = parts.filter((part) => part.kind === 'month');

    const base: Omit<ICompactMonthResult, 'skippedReason'> = {
      tableId,
      yyyymm,
      inputParts: parts.length,
      outputParts: 0,
      rows: 0,
      durationMs: 0,
    };
    if (dayParts.length === 0 && !options?.force) {
      return { ...base, durationMs: Date.now() - startedAt, skippedReason: 'no-day-parts' };
    }
    if (parts.length === 0) {
      return { ...base, durationMs: Date.now() - startedAt, skippedReason: 'empty-month' };
    }

    const inputs: IParsedPartKey[] = [...dayParts, ...monthParts];
    // never write the keys we are still reading (S3 GET vs same-key overwrite
    // is unspecified): new month parts start past the existing max seq and
    // healing drops the superseded keys afterwards
    const startSeq = monthParts.reduce((max, part) => Math.max(max, part.seq + 1), 0);
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
    const writtenKeys = new Set(entries.map((entry) => entry.key));

    // stats: replace exactly the consumed inputs with the fresh outputs; an
    // entry for a part that landed after our input snapshot belongs to a
    // concurrent run and stays intact
    const inputKeys = new Set(inputs.map((input) => input.key));
    const stats: ITableColdStats = (await this.coldStorage.readStats(tableId)) ?? {
      version: 1,
      tableId,
      parts: {},
    };
    for (const key of Object.keys(stats.parts)) {
      if (inputKeys.has(key)) delete stats.parts[key];
    }
    for (const entry of entries) {
      stats.parts[entry.key] = entry;
    }
    await this.coldStorage.writeStats(tableId, stats);

    // heal: delete exactly what this run consumed and superseded — never a
    // key that appeared after the input snapshot. A concurrent backfill or
    // flush may have written it, and it can be the only cold copy of rows
    // whose buffer entries that other run then deletes.
    const staleKeys = inputs
      .filter((input) => !writtenKeys.has(input.key))
      .map((input) => input.key);
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
