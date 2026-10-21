import { ColdBucketMergeFeeder } from '../cold-archive/bucket-merge-feeder';
import type { SortMemoryBudget } from './external-sort';
import { REMOVAL_ROW_CODEC } from './external-sort';
import type { IColdRemovalRow, IParsedPartKey, IPartStatsEntry } from './part-codec';
import { truncateRemovalRow } from './part-codec';
import type { PartWriter } from './part-writer';
import type { RecordRemovalColdStorageService } from './record-removal-cold-storage.service';

export class BucketMergeFeeder extends ColdBucketMergeFeeder<IColdRemovalRow, IPartStatsEntry> {
  constructor(
    writer: PartWriter,
    existingParts: IParsedPartKey[],
    coldStorage: RecordRemovalColdStorageService,
    sortBudget?: SortMemoryBudget,
    mergeFanIn?: number,
    truncateFieldUnits = 0,
    truncateRowUnits = 0
  ) {
    super(
      writer,
      existingParts,
      coldStorage,
      REMOVAL_ROW_CODEC,
      sortBudget,
      mergeFanIn,
      // parts written before the caps still hold multi-MB snapshots; heal on read-back
      truncateFieldUnits || truncateRowUnits
        ? (row) => truncateRemovalRow(row, truncateFieldUnits, truncateRowUnits)
        : undefined
    );
  }
}
