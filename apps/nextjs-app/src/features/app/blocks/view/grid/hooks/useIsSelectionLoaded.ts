import { SelectionRegionType, type CombinedSelection, type IRecordIndexMap } from '@teable/sdk';
import { useCallback } from 'react';

export const useIsSelectionLoaded = () => {
  return useCallback(
    ({
      selection,
      recordMap,
      rowCount,
    }: {
      selection: CombinedSelection;
      recordMap: IRecordIndexMap;
      rowCount: number;
    }) => {
      const ranges = selection.serialize();
      if (ranges.length === 0) {
        return false;
      }
      switch (selection.type) {
        case SelectionRegionType.Rows: {
          const start = ranges[0][0];
          const end = ranges[ranges.length - 1][1];
          return recordMap[start] && recordMap[end];
        }
        case SelectionRegionType.Columns:
          return recordMap[0] && recordMap[rowCount - 1];
        case SelectionRegionType.Cells: {
          const [[, startRowIndex], [, endRowIndex]] = ranges;
          return recordMap[startRowIndex] && recordMap[endRowIndex];
        }
      }
    },
    []
  );
};
