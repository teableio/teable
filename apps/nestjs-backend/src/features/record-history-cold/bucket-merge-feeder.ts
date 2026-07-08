import { ExternalRowSorter } from './external-sort';
import type { IColdHistoryRow, IParsedPartKey, IPartStatsEntry } from './part-codec';
import type { PartWriter } from './part-writer';
import type { RecordHistoryColdStorageService } from './record-history-cold-storage.service';

/**
 * Feeds a bucket's PartWriter with the deduplicated union of the live buffer
 * rows and the bucket's EXISTING cold parts, in byte order.
 *
 * Why a full external sort instead of a streaming merge:
 * - a bucket can legitimately be flushed more than once with disjoint row
 *   sets (the daily run at the horizon boundary covers only part of a day),
 *   so existing parts must be folded back in — never clobbered;
 * - NO input order can be trusted: the buffer stream follows the db
 *   collation, which orders mixed-case cuids differently than the byte
 *   comparator the part keys and read-path pruning use (a streaming merge
 *   under mismatched orders silently emits duplicates);
 * - each existing part is read to EOF immediately (short-lived GET) — dozens
 *   of half-open download streams interleaved with uploads on one HTTP
 *   client deadlock it (observed on the big-table e2e run).
 */
export class BucketMergeFeeder {
  private readonly sorter = new ExternalRowSorter();
  private initialized = false;
  /** rows folded back in from existing parts (not counted as flushed buffer rows) */
  mergedExistingRows = 0;

  constructor(
    private readonly writer: PartWriter,
    private readonly existingParts: IParsedPartKey[],
    private readonly coldStorage: RecordHistoryColdStorageService
  ) {}

  get bucket() {
    return this.writer.bucket;
  }

  get metrics() {
    return this.writer.metrics;
  }

  /**
   * the pre-existing part keys this feeder folded into the rewrite — the only
   * keys a heal pass may delete afterwards (a key that appeared concurrently
   * belongs to another run and must survive)
   */
  get consumedKeys(): Set<string> {
    return new Set(this.existingParts.map((part) => part.key));
  }

  async push(row: IColdHistoryRow): Promise<void> {
    await this.ensureInitialized();
    await this.sorter.add(row);
  }

  async finish(): Promise<IPartStatsEntry[]> {
    try {
      await this.ensureInitialized();
      await this.sorter.drainTo((row) => this.writer.add(row));
      return await this.writer.finish();
    } finally {
      await this.sorter.cleanup();
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    for (const part of this.existingParts) {
      for await (const item of this.coldStorage.iterateRows(part.key)) {
        if (!item.row) continue;
        await this.sorter.add(item.row);
        this.mergedExistingRows += 1;
      }
    }
  }
}
