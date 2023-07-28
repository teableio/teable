import { isEqual } from 'lodash';
import { useState } from 'react';
import { useRafState } from 'react-use';
import { DEFAULT_SELECTION_STATE } from '../configs';
import type {
  ICellItem,
  IMouseState,
  IPosition,
  IRange,
  ISelection,
  ISelectionState,
} from '../interface';
import { RegionType, SelectionRegionType } from '../interface';
import type { CoordinateManager } from '../managers';
import { inRange, isPointInsideRectangle, mixRanges } from '../utils';

export const useSelection = (coordInstance: CoordinateManager) => {
  const [activeCell, setActiveCell] = useRafState<ICellItem | null>(null);
  const [selectionState, setSelectionState] = useState<ISelectionState>(DEFAULT_SELECTION_STATE);
  const [prevSelectionState, setPrevSelectionState] = useState<ISelection | null>(null);
  const { pureRowCount } = coordInstance;

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
      case RegionType.RowHeaderDragHandler:
      case RegionType.RowHeaderCheckbox:
      case RegionType.ColumnHeader:
      case RegionType.AllCheckbox:
      case RegionType.RowHeader:
        return;
      default:
        setActiveCell(null);
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

  const onSelectionClick = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>,
    mouseState: IMouseState
    // eslint-disable-next-line sonarjs/cognitive-complexity
  ) => {
    const { type, rowIndex, columnIndex } = mouseState;
    const { type: prevSelectionType, ranges: prevRanges } = selectionState;
    const { shiftKey, metaKey } = event;
    const isShiftKey = shiftKey && !metaKey;
    const isMetaKey = metaKey && !shiftKey;

    switch (type) {
      case RegionType.ColumnHeader: {
        const isColumnSelection = prevSelectionType === SelectionRegionType.Columns;
        const thresholdColIndex = isShiftKey && isColumnSelection ? prevRanges[0][0] : columnIndex;

        let ranges = [
          [Math.min(thresholdColIndex, columnIndex), Math.max(thresholdColIndex, columnIndex)],
        ] as IRange[];
        if (isColumnSelection && isMetaKey) {
          ranges = mixRanges(prevRanges, [columnIndex, columnIndex]);
        }

        const isReset = !ranges.length;

        if (!isShiftKey || !isColumnSelection) {
          isReset ? setActiveCell(null) : setActiveCell([ranges[0][0], 0]);
        }
        const newSelectionState = isReset
          ? DEFAULT_SELECTION_STATE
          : {
              type: SelectionRegionType.Columns,
              ranges,
              isSelecting: false,
            };
        return setSelectionState(newSelectionState);
      }
      case RegionType.RowHeaderCheckbox: {
        const range = [rowIndex, rowIndex] as IRange;
        const ranges =
          prevSelectionType === SelectionRegionType.Rows ? mixRanges(prevRanges, range) : [range];
        return setSelectionState({ type: SelectionRegionType.Rows, ranges, isSelecting: false });
      }
      case RegionType.AllCheckbox: {
        const allRange = [0, pureRowCount - 1];
        const isPrevAll =
          prevSelectionType === SelectionRegionType.Rows && isEqual(prevRanges[0], allRange);
        const type = isPrevAll ? SelectionRegionType.None : SelectionRegionType.Rows;
        const ranges = (isPrevAll ? [] : [allRange]) as IRange[];
        return setSelectionState({ type, ranges, isSelecting: false });
      }
    }
  };

  const onSelectionContextMenu = (
    mouseState: IMouseState,
    callback: (selection: ISelection, position: IPosition) => void
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
      const isInsidePrevColumnRange =
        prevSelectionType === SelectionRegionType.Columns &&
        inRange(columnIndex, range[0], range[1]);

      if (isInsidePrevCellRange || isInsidePrevRowRange || isInsidePrevColumnRange) {
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
