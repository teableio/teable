import { useRef, useState } from 'react';
import { DEFAULT_DRAG_STATE } from '../configs';
import type { IDragState, IMouseState, IScrollState } from '../interface';
import { DragRegionType, RegionType } from '../interface';
import type { CoordinateManager } from '../managers';
import { inRange } from '../utils';

export const getDropTargetColumnIndex = (
  coordInstance: CoordinateManager,
  mouseState: IMouseState,
  scrollState: IScrollState
) => {
  const { x } = mouseState;
  const { scrollLeft } = scrollState;
  const { freezeRegionWidth } = coordInstance;
  const offsetX = x <= freezeRegionWidth ? x : scrollLeft + x;
  const hoverColumnIndex = coordInstance.getColumnStartIndex(offsetX);
  const hoverColumnOffsetX = coordInstance.getColumnOffset(hoverColumnIndex);
  const hoverColumnWidth = coordInstance.getColumnWidth(hoverColumnIndex);
  return inRange(offsetX, hoverColumnOffsetX, hoverColumnOffsetX + hoverColumnWidth / 2)
    ? hoverColumnIndex
    : hoverColumnIndex + 1;
};

export const useDrag = (coordInstance: CoordinateManager, scrollState: IScrollState) => {
  // Prevents Drag and Drop from Being Too Reactive
  const startPosition = useRef(0);
  const [dragState, setDragState] = useState<IDragState>(DEFAULT_DRAG_STATE);
  const { freezeColumnCount } = coordInstance;
  const { scrollTop, scrollLeft } = scrollState;

  const onDragStart = (mouseState: IMouseState) => {
    const { type, rowIndex, columnIndex, x, y } = mouseState;

    if (type === RegionType.RowHeaderDragHandler) {
      const offsetY = coordInstance.getRowOffset(rowIndex);
      setDragState({
        type: DragRegionType.Row,
        index: rowIndex,
        delta: y + scrollTop - offsetY,
        isDragging: false,
      });
    }

    if (type === RegionType.ColumnHeader) {
      startPosition.current = x;
      const offsetX = coordInstance.getColumnOffset(columnIndex);
      setDragState({
        type: DragRegionType.Column,
        index: columnIndex,
        delta: columnIndex < freezeColumnCount ? x - offsetX : x + scrollLeft - offsetX,
        isDragging: false,
      });
    }
  };

  const onDragChange = (mouseState: IMouseState) => {
    const { type } = dragState;
    if (![DragRegionType.Row, DragRegionType.Column].includes(type)) return;

    const { x, y } = mouseState;
    const prevPosition = type === DragRegionType.Row ? y : x;
    const moveDistance = Math.abs(prevPosition - startPosition.current);
    if (moveDistance < 5) return;

    setDragState((prev) => ({ ...prev, isDragging: true }));
  };

  const onDragEnd = (
    mouseState: IMouseState,
    onEnd: (colIndex: number, targetColIndex: number) => void
  ) => {
    const { type, isDragging } = dragState;

    if (!isDragging || !onEnd) return setDragState(DEFAULT_DRAG_STATE);

    if (type === DragRegionType.Column) {
      const { index: columnIndex } = dragState;
      const targetColumnIndex = getDropTargetColumnIndex(coordInstance, mouseState, scrollState);
      if (!inRange(targetColumnIndex, columnIndex, columnIndex + 1)) {
        onEnd(columnIndex, targetColumnIndex);
      }
    }
    setDragState(DEFAULT_DRAG_STATE);
  };

  return {
    dragState,
    onDragStart,
    onDragChange,
    onDragEnd,
  };
};
