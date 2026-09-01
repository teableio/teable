import { ColdBucketMergeFeeder } from '../cold-archive/bucket-merge-feeder';
import type { SortMemoryBudget } from './external-sort';
import { HISTORY_ROW_CODEC } from './external-sort';
import type { IColdHistoryRow, IParsedPartKey, IPartStatsEntry } from './part-codec';
import { truncateColdRow } from './part-codec';
import type { PartWriter } from './part-writer';
import type { RecordHistoryColdStorageService } from './record-history-cold-storage.service';

export class BucketMergeFeeder extends ColdBucketMergeFeeder<IColdHistoryRow, IPartStatsEntry> {
  constructor(
    writer: PartWriter,
    existingParts: IParsedPartKey[],
    coldStorage: RecordHistoryColdStorageService,
    sortBudget?: SortMemoryBudget,
    mergeFanIn?: number,
    truncateValueUnits = 0
  ) {
    super(
      writer,
      existingParts,
      coldStorage,
      HISTORY_ROW_CODEC,
      sortBudget,
      mergeFanIn,
      // parts written before the cap still hold multi-MB values; heal on read-back
      truncateValueUnits ? (row) => truncateColdRow(row, truncateValueUnits) : undefined
    );
  }
}
