import type { IPartBucket } from './bucket';
import type { IColdRowCodec, SortMemoryBudget } from './external-sort';
import { ColdRowSorter } from './external-sort';

/** the part-writer surface a feeder drives (see each subsystem's PartWriter) */
export interface IColdPartWriter<TRow, TStatsEntry> {
  readonly bucket: IPartBucket;
  readonly metrics: IColdPartWriteMetrics;
  /**
   * cleanup surface for a dead run: verified parts, plus any
   * verification-failed part whose immediate deletion failed
   */
  readonly writtenKeys?: readonly string[];
  add(row: TRow): Promise<void>;
  finish(): Promise<TStatsEntry[]>;
}

export interface IColdPartWriteMetrics {
  parts: number;
  rows: number;
  uncompressedBytes: number;
  compressedBytes: number;
}

/** the storage surface a feeder reads existing parts through */
export interface IColdRowSource<TRow> {
  iterateRows(key: string): AsyncGenerator<{ row?: TRow }>;
}

/**
 * Feeds a bucket's PartWriter with the deduplicated union of the live buffer
 * rows and the bucket's EXISTING cold parts, in the subsystem's canonical order.
 *
 * Why a full external sort instead of a streaming merge:
 * - a bucket can legitimately be flushed more than once with disjoint row sets
 *   (a run at the horizon boundary covers only part of a day), so existing
 *   parts must be folded back in, never clobbered;
 * - no input order can be trusted, and a streaming merge under mismatched
 *   orders silently emits duplicates;
 * - each existing part is read to EOF immediately: dozens of half-open
 *   downloads interleaved with uploads deadlock the shared HTTP client
 *   (observed on the big-table e2e run).
 *
 * Buffer reads can keep every bucket feeder of a table live at once, so each
 * feeder's run charges the one shared SortMemoryBudget — a per-feeder cap made
 * peak memory O(#buckets x run size) and OOM'd the 2026-07-08 drain.
 */
export class ColdBucketMergeFeeder<TRow extends { id: string }, TStatsEntry> {
  private readonly sorter: ColdRowSorter<TRow>;
  private initialized = false;
  /** rows folded back in from existing parts, not counted as flushed buffer rows */
  mergedExistingRows = 0;

  constructor(
    private readonly writer: IColdPartWriter<TRow, TStatsEntry>,
    private readonly existingParts: readonly { key: string }[],
    private readonly coldStorage: IColdRowSource<TRow>,
    codec: IColdRowCodec<TRow>,
    sortBudget?: SortMemoryBudget,
    mergeFanIn?: number,
    /** repair for rows read back from parts written before the truncation caps */
    private readonly heal?: (row: TRow) => TRow
  ) {
    this.sorter = new ColdRowSorter(codec, undefined, sortBudget, mergeFanIn);
  }

  get bucket(): IPartBucket {
    return this.writer.bucket;
  }

  get metrics(): IColdPartWriteMetrics {
    return this.writer.metrics;
  }

  /**
   * the keys this feeder folded in — the only ones a heal pass may delete
   * afterwards, since a key that appeared concurrently belongs to another run
   */
  get consumedKeys(): Set<string> {
    return new Set(this.existingParts.map((part) => part.key));
  }

  /** parts the writer already uploaded — orphans unless the run commits them */
  get uploadedKeys(): readonly string[] {
    return this.writer.writtenKeys ?? [];
  }

  async push(row: TRow): Promise<void> {
    await this.ensureInitialized();
    await this.sorter.add(row);
  }

  async finish(): Promise<TStatsEntry[]> {
    try {
      await this.ensureInitialized();
      await this.sorter.drainTo((row) => this.writer.add(row));
      return await this.writer.finish();
    } finally {
      await this.sorter.cleanup();
    }
  }

  /**
   * Release the sorter's budget charge, temp files and registry entry without
   * emitting anything — for a flush that dies after opening feeders but before
   * their finish loop. Idempotent, and safe whether or not finish() ran.
   */
  async abort(): Promise<void> {
    await this.sorter.cleanup();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    for (const part of this.existingParts) {
      for await (const item of this.coldStorage.iterateRows(part.key)) {
        if (!item.row) continue;
        const row = this.heal ? this.heal(item.row) : item.row;
        await this.sorter.add(row);
        this.mergedExistingRows += 1;
      }
    }
  }
}
