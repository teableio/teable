import { useRef, useState } from 'react';
import { DEFAULT_DRAG_STATE } from '../configs';
import type { IDragState, IMouseState, IRange, IScrollState } from '../interface';
import { DragRegionType, RegionType, DraggableType } from '../interface';
import type { CoordinateManager, CombinedSelection } from '../managers';
import { inRange } from '../utils';

export const getDropTargetIndex = (
  coordInstance: CoordinateManager,
  mouseState: IMouseState,
  scrollState: IScrollState,
  dragType: DragRegionType
) => {
  const { x, y } = mouseState;
  const { scrollLeft, scrollTop } = scrollState;
  const { freezeRegionWidth, rowInitSize } = coordInstance;

  if (dragType === DragRegionType.Columns) {
    const offsetX = x <= freezeRegionWidth ? x : scrollLeft + x;
    const hoverColumnIndex = coordInstance.getColumnStartIndex(offsetX);
    const hoverColumnOffsetX = coordInstance.getColumnOffset(hoverColumnIndex);
    const hoverColumnWidth = coordInstance.getColumnWidth(hoverColumnIndex);
    return inRange(offsetX, hoverColumnOffsetX, hoverColumnOffsetX + hoverColumnWidth / 2)
      ? hoverColumnIndex
      : hoverColumnIndex + 1;
  }
  if (dragType === DragRegionType.Rows) {
    const offsetY = y <= rowInitSize ? y : scrollTop + y;
    const hoverRowIndex = coordInstance.getRowStartIndex(offsetY);
    const hoverRowOffsetY = coordInstance.getRowOffset(hoverRowIndex);
    const hoverRowHeight = coordInstance.getRowHeight(hoverRowIndex);
    return inRange(offsetY, hoverRowOffsetY, hoverRowOffsetY + hoverRowHeight / 2)
      ? hoverRowIndex
      : hoverRowIndex + 1;
  }
  return -Infinity;
};

export const useDrag = (
  coordInstance: CoordinateManager,
  scrollState: IScrollState,
  selection: CombinedSelection,
  draggable?: DraggableType
) => {
  // Prevents Drag and Drop from Being Too Reactive
  const startPosition = useRef(0);
  const [dragState, setDragState] = useState<IDragState>(DEFAULT_DRAG_STATE);
  const { scrollTop, scrollLeft } = scrollState;

  const onDragStart = (
    mouseState: IMouseState,
    onEnd: (type: DragRegionType, dragIndexs: IRange[]) => void
  ) => {
    if (draggable === DraggableType.None) return;

    const { type, rowIndex: hoverRowIndex, columnIndex: hoverColumnIndex, x, y } = mouseState;
    const { isRowSelection, isColumnSelection, ranges: selectionRanges } = selection;

    if (type === RegionType.RowHeaderDragHandler && draggable !== DraggableType.Column) {
      startPosition.current = y;
      const ranges =
        isRowSelection && selection.includes([hoverRowIndex, hoverRowIndex])
          ? selectionRanges
          : ([[hoverRowIndex, hoverRowIndex]] as IRange[]);
      onEnd(DragRegionType.Rows, ranges);
      setDragState({
        type: DragRegionType.Rows,
        ranges,
        delta: y + scrollTop - coordInstance.getRowOffset(hoverRowIndex),
        isDragging: false,
      });
    }

    if (type === RegionType.ColumnHeader && draggable !== DraggableType.Row) {
      startPosition.current = x;
      const ranges =
        isColumnSelection && selection.includes([hoverColumnIndex, hoverColumnIndex])
          ? selectionRanges
          : ([[hoverColumnIndex, hoverColumnIndex]] as IRange[]);
      onEnd(DragRegionType.Columns, ranges);
      setDragState({
        type: DragRegionType.Columns,
        ranges,
        delta: x - coordInstance.getColumnRelativeOffset(hoverColumnIndex, scrollLeft),
        isDragging: false,
      });
    }
  };

  const onDragChange = (mouseState: IMouseState) => {
    const { type, isDragging } = dragState;
    if (isDragging) return;
    if (![DragRegionType.Rows, DragRegionType.Columns].includes(type)) return;

    const { x, y } = mouseState;
    const prevPosition = type === DragRegionType.Rows ? y : x;
    const moveDistance = Math.abs(prevPosition - startPosition.current);
    if (moveDistance < 5) return;

    setDragState((prev) => ({ ...prev, isDragging: true }));
  };

  const onDragEnd = (
    mouseState: IMouseState,
    onEnd: (dragIndexs: IRange[], dropIndex: number) => void
  ) => {
    const { type, isDragging } = dragState;

    if (!isDragging || !onEnd) return setDragState(DEFAULT_DRAG_STATE);

    if ([DragRegionType.Columns, DragRegionType.Rows].includes(type)) {
      const { ranges } = dragState;
      const targetIndex = getDropTargetIndex(coordInstance, mouseState, scrollState, type);
      if (!inRange(targetIndex, ranges[0][0], ranges[ranges.length - 1][1])) {
        onEnd(ranges, targetIndex);
      }
    }
    setDragState(DEFAULT_DRAG_STATE);
  };

  return {
    dragState,
    setDragState,
    onDragStart,
    onDragChange,
    onDragEnd,
  };
};
