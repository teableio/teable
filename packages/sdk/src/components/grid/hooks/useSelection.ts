import { useEffect, useRef, useState } from 'react';
import type { IGridProps } from '../Grid';
import type { ICellItem, IMouseState, IPosition, IRange } from '../interface';
import { RegionType, SelectionRegionType, SelectableType } from '../interface';
import { CombinedSelection, type CoordinateManager } from '../managers';

export const useSelection = (
  coordInstance: CoordinateManager,
  setActiveCell: React.Dispatch<React.SetStateAction<ICellItem | null>>,
  onSelectionChanged: IGridProps['onSelectionChanged'],
  selectable?: SelectableType,
  isMultiSelectionEnable?: boolean
) => {
  const [isSelecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState(() => new CombinedSelection());
  const prevSelectedRowIndex = useRef<number | null>(null);
  const { pureRowCount } = coordInstance;

  const onSelectionStart = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>,
    mouseState: IMouseState
  ) => {
    if (selectable !== SelectableType.All && selectable !== SelectableType.Cell) return;

    const { type, rowIndex, columnIndex } = mouseState;
    const { isRowSelection: isPrevRowSelection, ranges: prevRanges } = selection;
    const isShiftKey = event.shiftKey && !event.metaKey;

    switch (type) {
      case RegionType.Cell:
      case RegionType.ActiveCell: {
        const range = [columnIndex, rowIndex] as IRange;
        const isExpandSelection = isShiftKey && !isPrevRowSelection && prevRanges[0] != null;
        const ranges = [isExpandSelection ? prevRanges[0] : range, range];
        if (!isExpandSelection) {
          setActiveCell(range);
        }
        isMultiSelectionEnable && setSelecting(true);
        return setSelection(selection.set(SelectionRegionType.Cells, ranges));
      }
      case RegionType.RowHeaderDragHandler:
      case RegionType.RowHeaderCheckbox:
      case RegionType.ColumnHeader:
      case RegionType.AllCheckbox:
      case RegionType.RowHeader:
      case RegionType.AppendRow:
        return;
      default:
        setActiveCell(null);
        return setSelection(selection.reset());
    }
  };

  const onSelectionChange = (mouseState: IMouseState) => {
    const { isCellSelection, ranges } = selection;
    const { rowIndex, columnIndex } = mouseState;

    if (!isSelecting) return;
    if (isCellSelection && !selection.equals([ranges[0], [columnIndex, rowIndex]])) {
      setSelection(selection.merge([columnIndex, rowIndex]));
    }
  };

  const onSelectionEnd = () => {
    setSelecting(false);
  };

  const onSelectionClick = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>,
    mouseState: IMouseState
    // eslint-disable-next-line sonarjs/cognitive-complexity
  ) => {
    const { shiftKey, metaKey } = event;
    const isShiftKey = shiftKey && !metaKey;
    const isMetaKey = metaKey && !shiftKey;
    const { type, rowIndex, columnIndex } = mouseState;
    const {
      ranges: prevSelectionRanges,
      isColumnSelection: isPrevColumnSelection,
      isRowSelection: isPrevRowSelection,
    } = selection;

    const pureSelectColumnOrRow = (colOrRowIndex: number, type: SelectionRegionType) => {
      const range = [colOrRowIndex, colOrRowIndex] as IRange;
      const newSelection =
        isPrevRowSelection && isMultiSelectionEnable
          ? selection.merge(range)
          : selection.set(type, [range]);
      if (newSelection.includes(range)) {
        prevSelectedRowIndex.current = colOrRowIndex;
      }
      setActiveCell(null);
      setSelection(newSelection);
    };

    switch (type) {
      case RegionType.ColumnHeader: {
        if (selectable !== SelectableType.All && selectable !== SelectableType.Column) return;
        const thresholdColIndex =
          isMultiSelectionEnable && isShiftKey && isPrevColumnSelection
            ? prevSelectionRanges[0][0]
            : columnIndex;
        const ranges = [
          [Math.min(thresholdColIndex, columnIndex), Math.max(thresholdColIndex, columnIndex)],
        ] as IRange[];
        let newSelection = selection.set(SelectionRegionType.Columns, ranges);
        if (isMultiSelectionEnable && isMetaKey && isPrevColumnSelection) {
          newSelection = selection.merge([columnIndex, columnIndex]);
        }
        if (!isShiftKey || !isPrevColumnSelection) {
          const { isNoneSelection, ranges } = newSelection;
          isNoneSelection ? setActiveCell(null) : setActiveCell([ranges[0][0], 0]);
        }
        return setSelection(newSelection);
      }
      case RegionType.RowHeaderCheckbox: {
        if (selectable !== SelectableType.All && selectable !== SelectableType.Row) return;
        const range = [rowIndex, rowIndex] as IRange;
        if (
          isMultiSelectionEnable &&
          isShiftKey &&
          isPrevRowSelection &&
          prevSelectedRowIndex.current != null
        ) {
          if (selection.includes(range)) return;
          const prevIndex = prevSelectedRowIndex.current;
          const newRange = [Math.min(rowIndex, prevIndex), Math.max(rowIndex, prevIndex)] as IRange;
          const newSelection = selection.expand(newRange);
          prevSelectedRowIndex.current = rowIndex;
          setActiveCell(null);
          return setSelection(newSelection);
        }
        return pureSelectColumnOrRow(rowIndex, SelectionRegionType.Rows);
      }
      case RegionType.Cell: {
        if (selectable === SelectableType.Row) {
          return pureSelectColumnOrRow(rowIndex, SelectionRegionType.Rows);
        }
        if (selectable === SelectableType.Column) {
          return pureSelectColumnOrRow(columnIndex, SelectionRegionType.Columns);
        }
        return;
      }
      case RegionType.AllCheckbox: {
        if (selectable !== SelectableType.All && selectable !== SelectableType.Row) return;
        const allRanges = [[0, pureRowCount - 1]] as IRange[];
        const isPrevAll = isPrevRowSelection && selection.equals(allRanges);
        const newSelection = isPrevAll
          ? selection.reset()
          : selection.set(SelectionRegionType.Rows, allRanges);
        return setSelection(newSelection);
      }
    }
  };

  const onSelectionContextMenu = (
    mouseState: IMouseState,
    callback: (selection: CombinedSelection, position: IPosition) => void
    // eslint-disable-next-line sonarjs/cognitive-complexity
  ) => {
    const { x, y, columnIndex, rowIndex, type } = mouseState;
    if ([RegionType.Blank, RegionType.ColumnStatistic].includes(type)) return;
    const {
      isCellSelection: isPrevCellSelection,
      isRowSelection: isPrevRowSelection,
      isColumnSelection: isPrevColumnSelection,
    } = selection;
    const isCellHovered = columnIndex >= -1 && rowIndex > -1;
    const isColumnHovered = columnIndex > -1 && rowIndex === -1;

    if (isCellHovered) {
      const checkedRange = (
        isPrevCellSelection
          ? [columnIndex, rowIndex]
          : isPrevRowSelection
            ? [rowIndex, rowIndex]
            : isPrevColumnSelection
              ? [columnIndex, columnIndex]
              : undefined
      ) as IRange;
      const inPrevRanges = selection.includes(checkedRange);

      if (inPrevRanges) {
        return callback(selection, { x, y });
      }
      if (columnIndex > -1) {
        const range = [columnIndex, rowIndex] as IRange;
        const newSelection = selection.set(SelectionRegionType.Cells, [range, range]);
        setActiveCell(range);
        setSelection(newSelection);
        return callback(newSelection, { x, y });
      }
    }

    if (isColumnHovered) {
      const inPrevColumnRanges =
        isPrevColumnSelection && selection.includes([columnIndex, columnIndex]);

      if (inPrevColumnRanges) {
        return callback(selection, { x, y });
      }
      const newSelection = selection.set(SelectionRegionType.Columns, [[columnIndex, columnIndex]]);
      setActiveCell([columnIndex, 0]);
      setSelection(newSelection);
      callback(newSelection, { x, y });
    }
  };

  useEffect(() => {
    onSelectionChanged?.(selection);
  }, [onSelectionChanged, selection]);

  return {
    selection,
    isSelecting,
    setActiveCell,
    setSelection,
    onSelectionStart,
    onSelectionChange,
    onSelectionEnd,
    onSelectionClick,
    onSelectionContextMenu,
  };
};
