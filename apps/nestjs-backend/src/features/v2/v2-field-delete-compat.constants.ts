import type { IOtOperation } from '@teable/core';
import type { FieldDeleteSnapshotItem } from '@teable/v2-core';

export const V2_FIELD_DELETE_COMPAT_CONTEXT_KEY = '__teable_v2_field_delete_compat_context';

export interface IV2FieldDeleteCompatContext {
  tableId: string;
  userId: string;
  operationId: string;
  remainingFieldIds: Set<string>;
  frozenFieldOps: Record<string, IOtOperation[]>;
  snapshots: ReadonlyArray<FieldDeleteSnapshotItem>;
  referencesByFieldId: ReadonlyMap<string, ReadonlyArray<string>>;
  completed?: boolean;
}
