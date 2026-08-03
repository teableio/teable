import type { IOtOperation } from '@teable/core';
import { RecordOpBuilder } from '@teable/core';

export interface ICellChange {
  tableId: string;
  recordId: string;
  fieldId: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ICellContext {
  recordId: string;
  fieldId: string;
  newValue?: unknown;
  oldValue?: unknown;
}

export function changeToOp(change: ICellChange) {
  const { fieldId, oldValue, newValue } = change;
  return RecordOpBuilder.editor.setRecord.build({
    fieldId,
    oldCellValue: oldValue,
    newCellValue: newValue,
  });
}

export function formatChangesToOps(changes: ICellChange[]) {
  return changes.reduce<{
    [tableId: string]: { [recordId: string]: IOtOperation[] };
  }>((pre, cur) => {
    const { tableId: curTableId, recordId: curRecordId } = cur;
    const op = changeToOp(cur);

    if (!pre[curTableId]) {
      pre[curTableId] = {};
    }
    if (!pre[curTableId][curRecordId]) {
      pre[curTableId][curRecordId] = [];
    }
    pre[curTableId][curRecordId].push(op);

    return pre;
  }, {});
}

/**
 * when update multi field in a record, there may be duplicate change.
 * see this case, A and B update at the same time
 * A -> C -> E
 * A -> D -> E
 * B -> D -> E
 * D will be calculated twice
 * E will be calculated twice
 * so we need to merge duplicate change to reduce update times
 */
export function mergeDuplicateChange(changes: ICellChange[]) {
  const indexCache: { [key: string]: number } = {};
  const mergedChanges: ICellChange[] = [];

  for (const change of changes) {
    const key = `${change.tableId}#${change.fieldId}#${change.recordId}`;
    if (indexCache[key] !== undefined) {
      mergedChanges[indexCache[key]].newValue = change.newValue;
    } else {
      indexCache[key] = mergedChanges.length;
      mergedChanges.push(change);
    }
  }
  return mergedChanges;
}
