import { useState } from 'react';
import { DEFAULT_FREEZE_COLUMN_STATE } from '../configs';
import { RegionType } from '../interface';
import type { IScrollState, IColumnFreezeState, IMouseState } from '../interface';
import type { CoordinateManager } from '../managers';
import { inRange } from '../utils';

export const useColumnFreeze = (coordInstance: CoordinateManager, scrollState: IScrollState) => {
  const [columnFreezeState, setColumnFreezeState] = useState<IColumnFreezeState>(
    DEFAULT_FREEZE_COLUMN_STATE
  );

  const onColumnFreezeStart = (mouseState: IMouseState) => {
    const { type } = mouseState;

    if (type !== RegionType.ColumnFreezeHandler) return;

    const { freezeColumnCount } = coordInstance;
    setColumnFreezeState({
      sourceIndex: freezeColumnCount - 1,
      targetIndex: freezeColumnCount - 1,
      isFreezing: true,
    });
  };

  const onColumnFreezeMove = (mouseState: IMouseState) => {
    const { sourceIndex, isFreezing } = columnFreezeState;

    if (!isFreezing) return;

    const { scrollLeft } = scrollState;
    const { columnIndex, x } = mouseState;
    const { columnCount } = coordInstance;
    const columnWidth = coordInstance.getColumnWidth(columnIndex);
    const columnOffsetX = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
    const targetIndex = inRange(x, columnOffsetX, columnOffsetX + columnWidth / 2)
      ? columnIndex - 1
      : columnIndex;

    setColumnFreezeState({
      sourceIndex,
      targetIndex: Math.min(targetIndex, columnCount - 1),
      isFreezing: true,
    });
  };

  const onColumnFreezeEnd = (callbackFn?: (columnCount: number) => void) => {
    const { targetIndex, isFreezing } = columnFreezeState;
    if (!isFreezing) return;
    setColumnFreezeState(() => DEFAULT_FREEZE_COLUMN_STATE);
    callbackFn?.(Math.max(targetIndex + 1, 0));
  };

  return {
    columnFreezeState,
    onColumnFreezeStart,
    onColumnFreezeMove,
    onColumnFreezeEnd,
  };
};
