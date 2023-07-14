import { useEffect, useMemo } from 'react';
import type { IGridProps } from '../Grid';
import type { IScrollState } from '../interface';
import type { CoordinateManager } from '../managers';

export const useVisibleRegion = (
  coordInstance: CoordinateManager,
  scrollState: IScrollState,
  onVisibleRegionChanged: IGridProps['onVisibleRegionChanged']
) => {
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

  useEffect(() => {
    onVisibleRegionChanged?.({
      x: startColumnIndex,
      y: startRowIndex,
      width: stopColumnIndex - startColumnIndex,
      height: stopRowIndex - stopColumnIndex,
    });
  }, [onVisibleRegionChanged, startColumnIndex, startRowIndex, stopColumnIndex, stopRowIndex]);

  return useMemo(() => {
    return {
      startRowIndex,
      stopRowIndex,
      startColumnIndex,
      stopColumnIndex,
    };
  }, [startColumnIndex, startRowIndex, stopColumnIndex, stopRowIndex]);
};
