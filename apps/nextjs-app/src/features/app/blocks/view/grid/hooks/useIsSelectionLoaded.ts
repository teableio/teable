import {
  SelectionRegionType,
  type CombinedSelection,
  type IRange,
  type IRecordIndexMap,
} from '@teable/sdk';
import type { ILoadedRecordFields } from '@teable/sdk/utils/column-projection';
import { useCallback } from 'react';

const areFieldRangeLoaded = (
  fields: { id: string }[],
  loadedFieldIds: ReadonlySet<string>,
  start: number,
  end: number
): boolean => {
  for (let index = start; index <= end; index++) {
    const field = fields[index];
    if (field && !loadedFieldIds.has(field.id)) return false;
  }
  return true;
};

const areSelectionFieldsLoaded = (
  selection: CombinedSelection,
  ranges: IRange[],
  fields: { id: string }[],
  loadedFieldIds: ReadonlySet<string>
): boolean => {
  switch (selection.type) {
    case SelectionRegionType.Rows:
      return fields.every((field) => loadedFieldIds.has(field.id));
    case SelectionRegionType.Columns:
      return ranges.every(([start, end]) =>
        areFieldRangeLoaded(fields, loadedFieldIds, start, end)
      );
    case SelectionRegionType.Cells: {
      const [[start], [end]] = ranges;
      return areFieldRangeLoaded(fields, loadedFieldIds, start, end);
    }
    default:
      return false;
  }
};

const isSelectedRowLoaded = (
  rowIndex: number,
  selection: CombinedSelection,
  ranges: IRange[],
  recordMap: IRecordIndexMap,
  loadedFieldsByRecordId?: ReadonlyMap<string, ILoadedRecordFields>,
  snapshotFieldIds?: ReadonlySet<string>,
  fields?: { id: string }[]
): boolean => {
  const record = recordMap[rowIndex] as { id: string; docSource?: object } | undefined;
  if (!record) {
    return false;
  }
  if (!fields || (!loadedFieldsByRecordId && !snapshotFieldIds)) {
    return true;
  }
  const entry = loadedFieldsByRecordId?.get(record.id);
  const loadedFieldIds =
    entry && entry.source === record.docSource ? entry.fields : snapshotFieldIds;
  return Boolean(
    loadedFieldIds && areSelectionFieldsLoaded(selection, ranges, fields, loadedFieldIds)
  );
};

const areRowsLoaded = (
  start: number,
  end: number,
  isLoaded: (index: number) => boolean
): boolean => {
  for (let index = start; index <= end; index++) {
    if (!isLoaded(index)) return false;
  }
  return true;
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
      const isLoaded = (index: number) =>
        isSelectedRowLoaded(
          index,
          selection,
          ranges,
          recordMap,
          loadedFieldsByRecordId,
          snapshotFieldIds,
          fields
        );
      switch (selection.type) {
        case SelectionRegionType.Rows:
          return ranges.every(([start, end]) => areRowsLoaded(start, end, isLoaded));
        case SelectionRegionType.Columns:
          return rowCount !== 0 && areRowsLoaded(0, rowCount - 1, isLoaded);
        case SelectionRegionType.Cells: {
          const [[, start], [, end]] = ranges;
          return areRowsLoaded(start, end, isLoaded);
        }
        default:
          return false;
      }
    },
    []
  );
};
