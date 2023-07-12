import { useMemo } from 'react';
import type { IScrollState } from '../interface';
import type { CoordinateManager } from '../managers';

export const useVisibleRegion = (coordInstance: CoordinateManager, scrollState: IScrollState) => {
  const { scrollTop, scrollLeft } = scrollState;
  const { rowCount, columnCount } = coordInstance;

  const getVerticalRangeInfo = () => {
    const startIndex = coordInstance.getRowStartIndex(scrollTop);
    const stopIndex = coordInstance.getRowStopIndex(startIndex, scrollTop);

    return {
      startRowIndex: Math.max(0, startIndex),
      stopRowIndex: Math.max(0, Math.min(rowCount - 1, stopIndex + 1)),
    };
  };

  const getHorizontalRangeInfo = () => {
    const startIndex = coordInstance.getColumnStartIndex(scrollLeft);
    const stopIndex = coordInstance.getColumnStopIndex(startIndex, scrollLeft);

    return {
      startColumnIndex: Math.max(0, startIndex),
      stopColumnIndex: Math.max(0, Math.min(columnCount - 1, stopIndex)),
    };
  };

  const { startRowIndex, stopRowIndex } = getVerticalRangeInfo();
  const { startColumnIndex, stopColumnIndex } = getHorizontalRangeInfo();

  return useMemo(
    () => ({
      startRowIndex,
      stopRowIndex,
      startColumnIndex,
      stopColumnIndex,
    }),
    [startColumnIndex, stopColumnIndex, startRowIndex, stopRowIndex]
  );
};
