import { useMemo } from 'react';
import type { IScrollState } from '../interface';
import type { CoordinateManager } from '../managers';

export interface IVisibleRegion {
  startRowIndex: number;
  stopRowIndex: number;
  startColumnIndex: number;
  stopColumnIndex: number;
}

export const getVerticalRangeInfo = (coordInstance: CoordinateManager, scrollTop: number) => {
  const { rowCount } = coordInstance;
  const startIndex = coordInstance.getRowStartIndex(scrollTop);
  const stopIndex = coordInstance.getRowStopIndex(startIndex, scrollTop);

  return {
    startRowIndex: Math.max(0, startIndex),
    stopRowIndex: Math.max(0, Math.min(rowCount - 1, stopIndex + 1)),
  };
};

export const getHorizontalRangeInfo = (coordInstance: CoordinateManager, scrollLeft: number) => {
  const { columnCount } = coordInstance;
  const startIndex = coordInstance.getColumnStartIndex(scrollLeft);
  const stopIndex = coordInstance.getColumnStopIndex(startIndex, scrollLeft);

  return {
    startColumnIndex: Math.max(0, startIndex),
    stopColumnIndex: Math.max(0, Math.min(columnCount - 1, stopIndex)),
  };
};

export const useVisibleRegion = (
  coordInstance: CoordinateManager,
  scrollState: IScrollState,
  forceRenderFlag: string
) => {
  const { scrollTop, scrollLeft } = scrollState;

  return useMemo(() => {
    const { startRowIndex, stopRowIndex } = getVerticalRangeInfo(coordInstance, scrollTop);
    const { startColumnIndex, stopColumnIndex } = getHorizontalRangeInfo(coordInstance, scrollLeft);

    return {
      startRowIndex,
      stopRowIndex,
      startColumnIndex,
      stopColumnIndex,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordInstance, scrollTop, scrollLeft, forceRenderFlag]);
};
