import { RegionType } from '../interface';
import { getRegionData } from './region';

describe('getRegionData column header icons', () => {
  it('identifies a regular field icon as its own hover region', () => {
    const result = getRegionData({
      position: { x: 12, y: 16, rowIndex: -1, columnIndex: 0 },
      columns: [{ name: 'Total', icon: 'calculating' }],
      theme: { iconSizeXS: 16 },
      height: 500,
      scrollState: { scrollLeft: 0, scrollTop: 0 },
      dragState: { isDragging: false },
      selection: { isCellSelection: false },
      isSelecting: false,
      columnResizeState: { columnIndex: -1 },
      coordInstance: {
        rowInitSize: 32,
        getColumnWidth: () => 200,
        getColumnRelativeOffset: () => 0,
      },
      columnStatistics: null,
      isMultiSelectionEnable: false,
      rowControlPaddingX: 0,
      getLinearRow: () => ({ type: 'Row', realIndex: 0 }),
      rowControls: [],
      isFreezing: false,
      isOutOfBounds: false,
      isColumnFreezable: false,
      isColumnResizable: true,
      isColumnAppendEnable: false,
      isColumnHeaderMenuVisible: true,
      activeCell: null,
      activeCellBound: null,
      isFillEnabled: false,
      real2RowIndex: (index: number) => index,
    } as unknown as Parameters<typeof getRegionData>[0]);

    expect(result).toEqual({
      type: RegionType.ColumnIcon,
      x: 8,
      y: 8,
      width: 16,
      height: 16,
    });
  });

  it('keeps the column header clickable when the active cell row is not visible', () => {
    // All groups collapsed: the active cell row has no linear row, so
    // real2RowIndex returns undefined and getRowOffset would fall back to 0
    const result = getRegionData({
      position: { x: 12, y: 16, rowIndex: -1, columnIndex: 0 },
      columns: [{ name: 'Total' }],
      theme: { iconSizeXS: 16 },
      height: 500,
      scrollState: { scrollLeft: 0, scrollTop: 0 },
      dragState: { isDragging: false },
      selection: { isCellSelection: false },
      isSelecting: false,
      columnResizeState: { columnIndex: -1 },
      coordInstance: {
        rowInitSize: 32,
        getColumnWidth: () => 200,
        getColumnRelativeOffset: () => 0,
        getRowOffset: () => 0,
      },
      columnStatistics: null,
      isMultiSelectionEnable: false,
      rowControlPaddingX: 0,
      getLinearRow: () => ({ realIndex: -2 }),
      rowControls: [],
      isFreezing: false,
      isOutOfBounds: false,
      isColumnFreezable: false,
      isColumnResizable: false,
      isColumnAppendEnable: false,
      isColumnHeaderMenuVisible: false,
      activeCell: [0, 0],
      activeCellBound: { width: 200, height: 32, scrollEnable: false },
      isFillEnabled: false,
      real2RowIndex: () => undefined,
    } as unknown as Parameters<typeof getRegionData>[0]);

    expect(result).toEqual({
      type: RegionType.ColumnHeader,
      x: 0,
      y: 0,
      width: 200,
      height: 32,
    });
  });
});
