import { isEqual } from 'lodash';
import { useState } from 'react';
import { DEFAULT_SELECTION_STATE } from '../configs';
import type {
  ICellItem,
  IMouseState,
  IPosition,
  IRange,
  ISelectionBase,
  ISelectionState,
} from '../interface';
import { RegionType, SelectionRegionType } from '../interface';
import { inRange, isPointInsideRectangle, mergeRowRanges } from '../utils';

export const useSelection = () => {
  const [activeCell, setActiveCell] = useState<ICellItem | null>(null);
  const [selectionState, setSelectionState] = useState<ISelectionState>(DEFAULT_SELECTION_STATE);
  const [prevSelectionState, setPrevSelectionState] = useState<ISelectionBase | null>(null);

  const onSelectionStart = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>,
    mouseState: IMouseState
  ) => {
    const { type, rowIndex, columnIndex } = mouseState;
    const { type: prevSelectionType, ranges: prevRanges } = selectionState;
    const isShiftKey = event.shiftKey;

    setPrevSelectionState(selectionState);

    switch (type) {
      case RegionType.Cell: {
        const range = [columnIndex, rowIndex] as IRange;
        const needActive = prevSelectionType === SelectionRegionType.Rows;
        (!isShiftKey || needActive) && setActiveCell(range);
        return setSelectionState({
          type: SelectionRegionType.Cells,
          ranges: [isShiftKey && !needActive ? prevRanges[0] : range, range],
          isSelecting: true,
        });
      }
      case RegionType.ColumnHeader: {
        const needActive = prevSelectionType !== SelectionRegionType.Columns;
        (!isShiftKey || needActive) && setActiveCell([columnIndex, 0]);
        return setSelectionState({
          type: SelectionRegionType.Columns,
          ranges: [[isShiftKey && !needActive ? prevRanges[0][0] : columnIndex, columnIndex]],
          isSelecting: false,
        });
      }
      case RegionType.RowHeaderCheckbox:
      case RegionType.AllCheckbox:
      case RegionType.RowHeader:
        return;
      default:
        return setSelectionState(DEFAULT_SELECTION_STATE);
    }
  };

  const onSelectionChange = (mouseState: IMouseState) => {
    const { type, isSelecting } = selectionState;
    const { rowIndex, columnIndex } = mouseState;

    if (!isSelecting) return;

    if (type === SelectionRegionType.Cells) {
      setSelectionState((prev) => ({
        ...prev,
        ranges: [prev.ranges[0], [columnIndex, rowIndex]],
      }));
    }
  };

  const onSelectionEnd = (mouseState: IMouseState, callback?: (item: ICellItem) => void) => {
    const prev = prevSelectionState;
    setPrevSelectionState(null);
    const { type, ranges } = selectionState;
    const { type: prevType, ranges: prevRanges } = prev || {};
    const { type: hoverType } = mouseState;
    if (
      hoverType === RegionType.Cell &&
      type === SelectionRegionType.Cells &&
      prevType === SelectionRegionType.Cells &&
      isEqual(ranges, prevRanges) &&
      isEqual(ranges[0], ranges[1])
    ) {
      activeCell && callback?.(activeCell);
    }
    setSelectionState((prev) => ({ ...prev, isSelecting: false }));
  };

  const onSelectionClick = (mouseState: IMouseState, rowCount: number) => {
    const { type, rowIndex } = mouseState;

    if (type === RegionType.AllCheckbox) {
      return setSelectionState((prev) => {
        const allRange = [0, rowCount - 1];
        const { type: prevType, ranges: prevRanges } = prev;
        const isPrevAll = prevType === SelectionRegionType.Rows && isEqual(prevRanges[0], allRange);
        const type = isPrevAll ? SelectionRegionType.None : SelectionRegionType.Rows;
        const ranges = (isPrevAll ? [] : [allRange]) as IRange[];

        return {
          type,
          ranges,
          isSelecting: false,
        };
      });
    }

    if (type === RegionType.RowHeaderCheckbox) {
      return setSelectionState((prev) => {
        const { type: prevType, ranges: prevRanges } = prev;
        const range = [rowIndex, rowIndex] as IRange;
        const ranges =
          prevType === SelectionRegionType.Rows ? mergeRowRanges(prevRanges, range) : [range];
        return {
          type: SelectionRegionType.Rows,
          ranges,
          isSelecting: false,
        };
      });
    }
  };

  const onSelectionContextMenu = (
    mouseState: IMouseState,
    callback: (selection: ISelectionBase, position: IPosition) => void
  ) => {
    const { x, y, columnIndex, rowIndex } = mouseState;
    const { type: prevSelectionType, ranges } = selectionState;
    const isCellSelection = columnIndex >= -1 && rowIndex > -1;
    const isColumnSelection = columnIndex > -1 && rowIndex === -1;
    const range = ranges[0];

    if (isCellSelection) {
      const isInsidePrevCellRange =
        prevSelectionType === SelectionRegionType.Cells &&
        isPointInsideRectangle([columnIndex, rowIndex], ranges[0], ranges[1]);
      const isInsidePrevRowRange =
        prevSelectionType === SelectionRegionType.Rows && inRange(rowIndex, range[0], range[1]);

      if (isInsidePrevCellRange || isInsidePrevRowRange) {
        return callback({ type: prevSelectionType, ranges }, { x, y });
      }
      if (columnIndex > -1) {
        const newRange = [columnIndex, rowIndex] as IRange;
        const selection = {
          type: SelectionRegionType.Cells,
          ranges: [newRange, newRange],
        };
        setActiveCell(newRange);
        setSelectionState({ ...selection, isSelecting: false });
        return callback(selection, { x, y });
      }
    }

    if (isColumnSelection) {
      const isInsidePrevColumnRange =
        prevSelectionType === SelectionRegionType.Columns &&
        inRange(columnIndex, range[0], range[1]);

      if (isInsidePrevColumnRange) {
        return callback({ type: prevSelectionType, ranges }, { x, y });
      }
      const selection = {
        type: SelectionRegionType.Columns,
        ranges: [[columnIndex, columnIndex]] as IRange[],
      };
      setActiveCell([columnIndex, 0]);
      setSelectionState({ ...selection, isSelecting: false });
      callback(selection, { x, y });
    }
  };

  return {
    activeCell,
    setActiveCell,
    selectionState,
    setSelectionState,
    onSelectionStart,
    onSelectionChange,
    onSelectionEnd,
    onSelectionClick,
    onSelectionContextMenu,
  };
};
