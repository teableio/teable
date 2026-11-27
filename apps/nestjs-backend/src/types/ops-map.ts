import type { IOtOperation } from '@teable/core';

/** Operations grouped by table and record, as stored in field conversion history. */
export interface IOpsMap {
  [tableId: string]: {
    [keyId: string]: IOtOperation[];
  };
}
