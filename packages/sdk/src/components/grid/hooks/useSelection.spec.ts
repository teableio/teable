import { renderHook } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { act } from 'react';
import { vi } from 'vitest';
import type { ICellItem, ILinearRow, IMouseState } from '../interface';
import {
  LinearRowType,
  RegionType,
  RowControlType,
  SelectableType,
  SelectionRegionType,
} from '../interface';
import type { CoordinateManager } from '../managers';
import { useSelection } from './useSelection';

const coordInstance = { pureRowCount: 3 } as unknown as CoordinateManager;

const getLinearRow = (index: number): ILinearRow => ({
  type: LinearRowType.Row,
  displayIndex: index + 1,
  realIndex: index,
});

const createMouseState = (type: RegionType): IMouseState => ({
  type,
  rowIndex: 1,
  columnIndex: 0,
  x: 0,
  y: 0,
  isOutOfBounds: false,
});

const createMouseEvent = (): React.MouseEvent<HTMLDivElement, MouseEvent> =>
  ({
    shiftKey: false,
    metaKey: false,
  }) as React.MouseEvent<HTMLDivElement, MouseEvent>;

const createSetActiveCell = () => vi.fn() as unknown as Dispatch<SetStateAction<ICellItem | null>>;

describe('useSelection', () => {
  it('does not toggle row selection from cell clicks when row click selection is disabled', () => {
    const onRowControlClick = vi.fn();
    const { result } = renderHook(() =>
      useSelection({
        coordInstance,
        selectable: SelectableType.Row,
        isMultiSelectionEnable: true,
        isRowClickSelectionEnabled: false,
        getLinearRow,
        setActiveCell: createSetActiveCell(),
        onSelectionChanged: undefined,
        onRowControlClick,
      })
    );

    act(() => {
      result.current.onSelectionClick(createMouseEvent(), createMouseState(RegionType.Cell));
    });

    expect(onRowControlClick).not.toHaveBeenCalled();
    expect(result.current.selection.type).toBe(SelectionRegionType.None);
  });

  it('keeps checkbox row toggling when row click selection is disabled', () => {
    const onRowControlClick = vi.fn();
    const { result } = renderHook(() =>
      useSelection({
        coordInstance,
        selectable: SelectableType.Row,
        isMultiSelectionEnable: true,
        isRowClickSelectionEnabled: false,
        getLinearRow,
        setActiveCell: createSetActiveCell(),
        onSelectionChanged: undefined,
        onRowControlClick,
      })
    );

    act(() => {
      result.current.onSelectionClick(
        createMouseEvent(),
        createMouseState(RegionType.RowHeaderCheckbox)
      );
    });

    expect(onRowControlClick).toHaveBeenCalledWith(1, RowControlType.Checkbox, true);
    expect(result.current.selection.type).toBe(SelectionRegionType.Rows);
    expect(result.current.selection.ranges).toEqual([[1, 1]]);
  });

  it('toggles row selection from cell clicks by default', () => {
    const onRowControlClick = vi.fn();
    const { result } = renderHook(() =>
      useSelection({
        coordInstance,
        selectable: SelectableType.Row,
        isMultiSelectionEnable: true,
        getLinearRow,
        setActiveCell: createSetActiveCell(),
        onSelectionChanged: undefined,
        onRowControlClick,
      })
    );

    act(() => {
      result.current.onSelectionClick(createMouseEvent(), createMouseState(RegionType.Cell));
    });

    expect(onRowControlClick).toHaveBeenCalledWith(1, RowControlType.Checkbox, true);
    expect(result.current.selection.type).toBe(SelectionRegionType.Rows);
    expect(result.current.selection.ranges).toEqual([[1, 1]]);
  });
});
