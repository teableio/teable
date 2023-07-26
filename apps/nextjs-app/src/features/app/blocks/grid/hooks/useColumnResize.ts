import { useState } from 'react';
import { DEFAULT_COLUMN_RESIZE_STATE, GRID_DEFAULT } from '../configs';
import type { IMouseState, IColumnResizeState, IScrollState } from '../interface';
import { RegionType } from '../interface';
import type { CoordinateManager } from '../managers';
import { inRange } from '../utils';

export const useColumnResize = (coordInstance: CoordinateManager, scrollState: IScrollState) => {
  const [columnResizeState, setColumnResizeState] = useState<IColumnResizeState>(
    DEFAULT_COLUMN_RESIZE_STATE
  );

  const onColumnResizeStart = (mouseState: IMouseState) => {
    const { type, columnIndex, x } = mouseState;
    const { freezeColumnCount } = coordInstance;
    const { scrollLeft } = scrollState;

    if (type === RegionType.ColumnResizeHandler) {
      const { columnResizeHandlerWidth } = GRID_DEFAULT;
      let startOffsetX = coordInstance.getColumnOffset(columnIndex);
      startOffsetX = columnIndex < freezeColumnCount ? startOffsetX : startOffsetX - scrollLeft;
      const realColumnIndex = inRange(x, startOffsetX, startOffsetX + columnResizeHandlerWidth / 2)
        ? columnIndex - 1
        : columnIndex;

      setColumnResizeState({
        x,
        columnIndex: realColumnIndex,
        width: coordInstance.getColumnWidth(realColumnIndex),
      });
    }
  };

  const onColumnResizeChange = (
    mouseState: IMouseState,
    onResize?: (newSize: number, colIndex: number) => void
  ) => {
    const { x } = mouseState;
    const { columnIndex: resizeColumnIndex, x: resizeX } = columnResizeState;
    if (resizeColumnIndex > -1) {
      const columnWidth = coordInstance.getColumnWidth(resizeColumnIndex);
      const newWidth = Math.max(100, Math.round(columnWidth + x - resizeX));
      setColumnResizeState({
        x,
        columnIndex: resizeColumnIndex,
        width: newWidth,
      });
      return onResize?.(newWidth, resizeColumnIndex);
    }
  };

  const onColumnResizeEnd = () => {
    setColumnResizeState(DEFAULT_COLUMN_RESIZE_STATE);
  };

  return {
    columnResizeState,
    setColumnResizeState,
    onColumnResizeStart,
    onColumnResizeChange,
    onColumnResizeEnd,
  };
};
