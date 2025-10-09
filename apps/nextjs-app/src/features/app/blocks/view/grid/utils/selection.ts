import { FieldType } from '@teable/core';
import type { CombinedSelection } from '@teable/sdk/components';
import { SelectionRegionType } from '@teable/sdk/components';
import type { Field } from '@teable/sdk/model';
import { isEqual, range } from 'lodash';

export const selectionCoverAttachments = (selection: CombinedSelection, fields: Field[]) => {
  const { type, ranges } = selection;
  switch (type) {
    case SelectionRegionType.Cells: {
      const [start, end] = ranges;
      return fields
        .slice(start[0], end[0] + 1)
        .every((field) => field.type === FieldType.Attachment && !field.isComputed);
    }
    case SelectionRegionType.Rows: {
      return fields.every((field) => field.type === FieldType.Attachment && !field.isComputed);
    }
    case SelectionRegionType.Columns: {
      let allFieldsAreAttachments = true;
      for (let i = 0; i < ranges.length; i++) {
        const start = ranges[i][0];
        const end = ranges[i][1];
        const fieldsInRange = fields.slice(start, end + 1);
        const areAllAttachments = fieldsInRange.every(
          (field) => field.type === FieldType.Attachment && !field.isComputed
        );
        if (!areAllAttachments) {
          allFieldsAreAttachments = false;
          break;
        }
      }
      return allFieldsAreAttachments;
    }
    default:
      return false;
  }
};

export const getSelectionCell = (selection: CombinedSelection) => {
  const { type, ranges } = selection;
  const isSelectionCell =
    type === SelectionRegionType.Cells && ranges.length === 2 && isEqual(ranges[0], ranges[1]);
  if (!isSelectionCell) {
    return;
  }
  return ranges[0];
};

export const getActiveCell = (selection: CombinedSelection) => {
  const { type, ranges } = selection;
  switch (type) {
    case SelectionRegionType.Cells: {
      return ranges[0];
    }
    case SelectionRegionType.Rows: {
      return [0, ranges[0][0]];
    }
    case SelectionRegionType.Columns: {
      return [ranges[0][0], 0];
    }
    default:
      return null;
  }
};

export const getEffectCellCount = (
  selection: CombinedSelection,
  fields: Field[],
  rowCount: number | null
) => {
  const calFieldsIndex = [] as number[];
  fields.forEach((field, index) => {
    if (field.isComputed) {
      calFieldsIndex.push(index);
    }
  });

  if (selection.type === SelectionRegionType.Columns && rowCount) {
    const columnWithoutCal = [];
    selection.ranges.forEach((currentRange) => {
      const [startCol, endCol] = currentRange;
      if (startCol === endCol && !calFieldsIndex.includes(startCol)) {
        columnWithoutCal.push(startCol);
      }

      if (startCol !== endCol) {
        const cols = range(startCol, endCol + 1);
        const finalCols = cols.filter((col) => !calFieldsIndex.includes(col));
        columnWithoutCal.push(...finalCols);
      }
    });
    return columnWithoutCal.length * rowCount;
  }

  if (selection.type === SelectionRegionType.Cells) {
    const [startRange, endRange] = selection.ranges;
    const [startCol, startRow] = startRange;
    const [endCol, endRow] = endRange;
    const selectionRows = endRow - startRow + 1;

    const colWithoutComputedFieldLength = range(startCol, endCol + 1)?.filter(
      (index) => !calFieldsIndex.includes(index)
    )?.length;

    return colWithoutComputedFieldLength * selectionRows;
  }

  if (selection.type === SelectionRegionType.Rows) {
    // all select
    const [startRow, endRow] = selection.ranges as unknown as [number, number];
    const rows = endRow - startRow + 1;
    const fieldsWithoutCal = fields?.filter((f) => !f.isComputed);
    return fieldsWithoutCal?.length * rows;
  }

  return 0;
};

export const getEffectRows = (selection: CombinedSelection) => {
  const { type, ranges } = selection;
  if (type === SelectionRegionType.Rows) {
    return ranges.reduce((acc, range) => acc + range[1] - range[0] + 1, 0);
  }

  if (type === SelectionRegionType.Cells) {
    const [startRange, endRange] = selection.ranges;
    const [, startRow] = startRange;
    const [, endRow] = endRange;
    return endRow - startRow + 1;
  }

  return 0;
};
