import { isEqual } from 'lodash';
import { useState } from 'react';
import { DEFAULT_SELECTION_STATE } from '../configs';
import type { IMouseState, IRange, ISelectionState } from '../interface';
import { RegionType, SelectionRegionType } from '../interface';
import { mergeRowRanges } from '../utils';

export const useSelection = (rowCount: number) => {
  const [selectionState, setSelectionState] = useState<ISelectionState>(DEFAULT_SELECTION_STATE);
  const [prevSelectionState, setPrevSelectionState] = useState<Omit<
    ISelectionState,
    'isSelecting'
  > | null>(null);

  const onSelectionStart = (mouseState: IMouseState) => {
    const { type, rowIndex, columnIndex } = mouseState;
    setPrevSelectionState(selectionState);

    switch (type) {
      case RegionType.Cell:
        return setSelectionState({
          type: SelectionRegionType.Cells,
          ranges: [
            [columnIndex, rowIndex],
            [columnIndex, rowIndex],
          ],
          isSelecting: true,
        });
      case RegionType.ColumnHeader:
        return setSelectionState({
          type: SelectionRegionType.Column,
          ranges: [[columnIndex, columnIndex]],
          isSelecting: false,
        });
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

  const onSelectionEnd = (callback?: (isEditMode: boolean) => void) => {
    const prev = prevSelectionState;
    setPrevSelectionState(null);
    const { type, ranges } = selectionState;
    const { type: prevType, ranges: prevRanges } = prev || {};
    if (
      type === SelectionRegionType.Cells &&
      prevType === SelectionRegionType.Cells &&
      isEqual(ranges, prevRanges) &&
      isEqual(ranges[0], ranges[1])
    ) {
      callback?.(true);
    }
    setSelectionState((prev) => ({ ...prev, isSelecting: false }));
  };

  const onSelectionClick = (mouseState: IMouseState) => {
    const { type, rowIndex } = mouseState;

    if (type === RegionType.AllCheckbox) {
      return setSelectionState((prev) => {
        const allRange = [0, rowCount - 1];
        const { type: prevType, ranges: prevRanges } = prev;
        const isPrevAll = prevType === SelectionRegionType.Row && isEqual(prevRanges[0], allRange);
        const type = isPrevAll ? SelectionRegionType.None : SelectionRegionType.Row;
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
          prevType === SelectionRegionType.Row ? mergeRowRanges(prevRanges, range) : [range];
        return {
          type: SelectionRegionType.Row,
          ranges,
          isSelecting: false,
        };
      });
    }
  };

  return {
    selectionState,
    setSelectionState,
    onSelectionStart,
    onSelectionChange,
    onSelectionEnd,
    onSelectionClick,
  };
};
