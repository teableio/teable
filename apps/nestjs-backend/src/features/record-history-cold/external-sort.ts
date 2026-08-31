import type { IColdRowCodec, SortMemoryBudget } from '../cold-archive/external-sort';
import { ColdRowSorter } from '../cold-archive/external-sort';
import type { IColdHistoryRow } from './part-codec';
import { compareRowAsc } from './part-codec';

export { SortMemoryBudget } from '../cold-archive/external-sort';

/** the budgeting unit for sort runs and read batches */
export const approxColdRowBytes = (row: IColdHistoryRow): number =>
  64 +
  row.id.length +
  row.recordId.length +
  row.fieldId.length +
  row.before.length +
  row.after.length +
  row.createdTime.length +
  row.createdBy.length;

export const HISTORY_ROW_CODEC: IColdRowCodec<IColdHistoryRow> = {
  compare: compareRowAsc,
  sizeOf: approxColdRowBytes,
  tmpPrefix: 'rh-cold',
};

export class ExternalRowSorter extends ColdRowSorter<IColdHistoryRow> {
  constructor(runSize?: number, budget?: SortMemoryBudget, mergeFanIn?: number) {
    super(HISTORY_ROW_CODEC, runSize, budget, mergeFanIn);
  }
}
