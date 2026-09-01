import type { IColdRowCodec, SortMemoryBudget } from '../cold-archive/external-sort';
import { ColdRowSorter } from '../cold-archive/external-sort';
import type { IColdRemovalRow } from './part-codec';
import { compareRemovalRowDesc } from './part-codec';

export { SortMemoryBudget } from '../cold-archive/external-sort';

// the budgeting unit for sort runs and read batches
export const approxRemovalRowBytes = (row: IColdRemovalRow): number =>
  64 +
  row.id.length +
  row.recordId.length +
  row.snapshot.length +
  row.reason.length +
  row.removedTime.length +
  row.removedBy.length +
  (row.operationId?.length ?? 0) +
  (row.recordCreatedTime?.length ?? 0) +
  (row.recordCreatedBy?.length ?? 0) +
  (row.recordLastModifiedTime?.length ?? 0) +
  (row.recordLastModifiedBy?.length ?? 0);

export const REMOVAL_ROW_CODEC: IColdRowCodec<IColdRemovalRow> = {
  compare: compareRemovalRowDesc,
  sizeOf: approxRemovalRowBytes,
  tmpPrefix: 'rr-cold',
};

export class ExternalRowSorter extends ColdRowSorter<IColdRemovalRow> {
  constructor(runSize?: number, budget?: SortMemoryBudget, mergeFanIn?: number) {
    super(REMOVAL_ROW_CODEC, runSize, budget, mergeFanIn);
  }
}
