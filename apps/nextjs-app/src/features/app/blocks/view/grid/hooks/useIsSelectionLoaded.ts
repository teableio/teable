import { SelectionRegionType, type CombinedSelection, type IRecordIndexMap } from '@teable/sdk';
import type { ILoadedRecordFields } from '@teable/sdk/utils/column-projection';
import { useCallback } from 'react';

const selectionFieldIds = (selection: CombinedSelection, fields: { id: string }[]): string[] => {
  const ranges = selection.serialize();
  switch (selection.type) {
    case SelectionRegionType.Rows:
      return fields.map((field) => field.id);
    case SelectionRegionType.Columns: {
      const ids: string[] = [];
      for (const [startColIndex, endColIndex] of ranges) {
        for (let columnIndex = startColIndex; columnIndex <= endColIndex; columnIndex++) {
          const fieldId = fields[columnIndex]?.id;
          if (fieldId) {
            ids.push(fieldId);
          }
        }
      }
      return ids;
    }
    case SelectionRegionType.Cells: {
      const [[startColIndex], [endColIndex]] = ranges;
      return fields.slice(startColIndex, endColIndex + 1).map((field) => field.id);
    }
    default:
      return [];
  }
};

const selectionRecords = (
  selection: CombinedSelection,
  recordMap: IRecordIndexMap,
  rowCount: number
) => {
  const ranges = selection.serialize();
  const records: { id: string; docSource?: object }[] = [];
  const pushRow = (rowIndex: number) => {
    const record = recordMap[rowIndex] as { id: string; docSource?: object } | undefined;
    if (record) {
      records.push(record);
    }
  };
  switch (selection.type) {
    case SelectionRegionType.Rows: {
      for (const [startRowIndex, endRowIndex] of ranges) {
        for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
          pushRow(rowIndex);
        }
      }
      return records;
    }
    case SelectionRegionType.Columns: {
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        pushRow(rowIndex);
      }
      return records;
    }
    case SelectionRegionType.Cells: {
      const [[, startRowIndex], [, endRowIndex]] = ranges;
      for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
        pushRow(rowIndex);
      }
      return records;
    }
    default:
      return records;
  }
};

export const useIsSelectionLoaded = () => {
  return useCallback(
    ({
      selection,
      recordMap,
      rowCount,
      loadedFieldsByRecordId,
      snapshotFieldIds,
      fields,
    }: {
      selection: CombinedSelection;
      recordMap: IRecordIndexMap;
      rowCount: number;
      loadedFieldsByRecordId?: ReadonlyMap<string, ILoadedRecordFields>;
      snapshotFieldIds?: ReadonlySet<string>;
      fields?: { id: string }[];
    }) => {
      const ranges = selection.serialize();
      if (ranges.length === 0) {
        return false;
      }
      let rowsLoaded = false;
      switch (selection.type) {
        case SelectionRegionType.Rows: {
          const start = ranges[0][0];
          const end = ranges[ranges.length - 1][1];
          rowsLoaded = Boolean(recordMap[start] && recordMap[end]);
          break;
        }
        case SelectionRegionType.Columns:
          rowsLoaded = Boolean(recordMap[0] && recordMap[rowCount - 1]);
          break;
        case SelectionRegionType.Cells: {
          const [[, startRowIndex], [, endRowIndex]] = ranges;
          rowsLoaded = Boolean(recordMap[startRowIndex] && recordMap[endRowIndex]);
          break;
        }
        default:
          return false;
      }
      if (!rowsLoaded) {
        return false;
      }
      if (!fields) {
        return true;
      }
      if (!loadedFieldsByRecordId && !snapshotFieldIds) {
        return true;
      }
      const fieldIds = selectionFieldIds(selection, fields);
      return selectionRecords(selection, recordMap, rowCount).every((record) => {
        const entry = loadedFieldsByRecordId?.get(record.id);
        const loaded = entry && entry.source === record.docSource ? entry.fields : snapshotFieldIds;
        return Boolean(loaded && fieldIds.every((fieldId) => loaded.has(fieldId)));
      });
    },
    []
  );
};
