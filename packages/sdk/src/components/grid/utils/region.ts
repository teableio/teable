/* eslint-disable @typescript-eslint/naming-convention */
import { GRID_DEFAULT } from '../configs';
import { LinearRowType, RegionType, RowControlType } from '../interface';
import type {
  IActiveCellBound,
  ICellItem,
  IRectangle,
  IRegionPosition,
  IRowControlItem,
} from '../interface';
import type { IRenderLayerProps } from '../RenderLayer';
import { inRange } from './range';

interface ICheckRegionProps
  extends Pick<
    IRenderLayerProps,
    | 'theme'
    | 'height'
    | 'columns'
    | 'scrollState'
    | 'dragState'
    | 'selection'
    | 'isSelecting'
    | 'columnResizeState'
    | 'coordInstance'
    | 'columnStatistics'
    | 'isMultiSelectionEnable'
    | 'getLinearRow'
  > {
  rowControls: IRowControlItem[];
  position: IRegionPosition;
  isFreezing: boolean;
  isOutOfBounds: boolean;
  isColumnFreezable: boolean;
  isColumnResizable: boolean;
  isColumnAppendEnable: boolean;
  isColumnHeaderMenuVisible: boolean;
  activeCell: ICellItem | null;
  activeCellBound: IActiveCellBound | null;
  real2RowIndex: (index: number) => number;
}

export interface IRegionData extends IRectangle {
  type: RegionType;
  rowIndex?: number;
  columnIndex?: number;
  isOutOfBounds?: boolean;
}

// Define all possible row controls and their corresponding RegionTypes
const rowControlDefinitions = {
  [RowControlType.Drag]: RegionType.RowHeaderDragHandler,
  [RowControlType.Checkbox]: RegionType.RowHeaderCheckbox,
  [RowControlType.Expand]: RegionType.RowHeaderExpandHandler,
};

export const BLANK_REGION_DATA = {
  type: RegionType.Blank,
  x: Infinity,
  y: Infinity,
  width: 0,
  height: 0,
};

const {
  groupHeaderHeight,
  columnHeadPadding,
  columnResizeHandlerWidth,
  rowHeadIconPaddingTop,
  columnStatisticHeight,
  columnFreezeHandlerWidth,
  minColumnStatisticWidth,
} = GRID_DEFAULT;

export const getRegionData = (props: ICheckRegionProps): IRegionData => {
  return (
    checkIfFreezing(props) ||
    checkIsActiveCell(props) ||
    checkIsOutOfBounds(props) ||
    checkIfSelecting(props) ||
    checkIfColumnResizing(props) ||
    checkIfDragging(props) ||
    checkIsFreezeColumnHandler(props) ||
    checkIsAppendColumn(props) ||
    checkIsColumnStatistic(props) ||
    checkIsAllCheckbox(props) ||
    checkIsAppendRow(props) ||
    checkIsRowHeader(props) ||
    checkIsRowGroupHeader(props) ||
    // checkIsFillHandler(props) ||
    checkIsCell(props) ||
    checkIsColumnHeader(props) ||
    BLANK_REGION_DATA
  );
};

const checkIfFreezing = (props: ICheckRegionProps): IRegionData | null => {
  const { isFreezing } = props;
  if (!isFreezing) return null;
  return { ...BLANK_REGION_DATA, type: RegionType.ColumnFreezeHandler };
};

const checkIsActiveCell = (props: ICheckRegionProps): IRegionData | null => {
  const { coordInstance, scrollState, position, activeCell, activeCellBound, real2RowIndex } =
    props;
  if (activeCell == null || activeCellBound == null) return null;
  const { x, y } = position;
  const { scrollTop, scrollLeft } = scrollState;
  const [columnIndex, rowIndex] = activeCell;
  const linearRowIndex = real2RowIndex(rowIndex);
  const offsetY = coordInstance.getRowOffset(linearRowIndex) - scrollTop;
  const offsetX = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
  const { width, height } = activeCellBound;

  if (inRange(x, offsetX, offsetX + width) && inRange(y, offsetY, offsetY + height)) {
    return {
      type: RegionType.ActiveCell,
      x: offsetX,
      y: offsetY,
      width,
      height,
      rowIndex: linearRowIndex,
      columnIndex,
      isOutOfBounds: false,
    };
  }
  return null;
};

const checkIsOutOfBounds = (props: ICheckRegionProps): IRegionData | null => {
  const { isOutOfBounds } = props;
  return isOutOfBounds ? BLANK_REGION_DATA : null;
};

const checkIfSelecting = (props: ICheckRegionProps): IRegionData | null => {
  const { selection, isSelecting } = props;
  if (!isSelecting || !selection.isCellSelection) return null;
  return { ...BLANK_REGION_DATA, type: RegionType.Cell };
};

const checkIfColumnResizing = (props: ICheckRegionProps): IRegionData | null => {
  const { columnIndex } = props.columnResizeState;
  if (columnIndex <= -1) return null;
  return { ...BLANK_REGION_DATA, type: RegionType.ColumnResizeHandler };
};

const checkIfDragging = (props: ICheckRegionProps): IRegionData | null => {
  const { isDragging } = props.dragState;
  if (!isDragging) return null;
  return { ...BLANK_REGION_DATA, type: RegionType.ColumnHeader };
};

const checkIsFreezeColumnHandler = (props: ICheckRegionProps): IRegionData | null => {
  const { position, scrollState, coordInstance, isColumnFreezable } = props;
  if (!isColumnFreezable) return null;
  const { x, y } = position;
  const { scrollTop } = scrollState;
  const { freezeRegionWidth, rowInitSize, rowCount, containerHeight } = coordInstance;
  const offsetY = coordInstance.getRowOffset(rowCount) - scrollTop;
  const maxY = Math.min(offsetY, containerHeight - columnStatisticHeight);
  const halfWidth = columnFreezeHandlerWidth / 2;
  if (
    inRange(x, freezeRegionWidth - halfWidth, freezeRegionWidth + halfWidth) &&
    inRange(y, rowInitSize, maxY)
  ) {
    return { ...BLANK_REGION_DATA, type: RegionType.ColumnFreezeHandler };
  }
  return null;
};

const checkIsAppendColumn = (props: ICheckRegionProps): IRegionData | null => {
  const { position, isColumnAppendEnable } = props;
  const { rowIndex, columnIndex } = position;
  if (isColumnAppendEnable && rowIndex >= -1 && columnIndex === -2) {
    return { ...BLANK_REGION_DATA, type: RegionType.AppendColumn };
  }
  return null;
};

export const getColumnStatisticData = (
  props: Pick<
    IRenderLayerProps,
    'height' | 'scrollState' | 'coordInstance' | 'columnStatistics' | 'getLinearRow'
  > & {
    position: IRegionPosition;
  }
) => {
  const { columnStatistics, scrollState, coordInstance, getLinearRow, position, height } = props;
  if (columnStatistics == null) return null;
  const { scrollLeft, scrollTop } = scrollState;
  const { x, y, rowIndex, columnIndex } = position;

  if (rowIndex > -1 && columnIndex > -1) {
    const { type } = getLinearRow(rowIndex);
    const isFirstColumn = columnIndex === 0;
    const columnWidth = coordInstance.getColumnWidth(columnIndex);
    const columnOffsetX = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
    const groupedStatisticX = isFirstColumn
      ? columnOffsetX + columnWidth - minColumnStatisticWidth
      : columnOffsetX;

    if (
      type === LinearRowType.Group &&
      inRange(
        x,
        groupedStatisticX,
        groupedStatisticX + (isFirstColumn ? minColumnStatisticWidth : columnWidth)
      )
    ) {
      return {
        type: RegionType.GroupStatistic,
        x: columnOffsetX,
        y: coordInstance.getRowOffset(rowIndex) - scrollTop,
        width: columnWidth,
        height: columnStatisticHeight,
      };
    }
  }

  const isBottomRegion = inRange(y, height - columnStatisticHeight, height);
  const isColumnStatistic = isBottomRegion && columnIndex > -1;
  const isRowCountLabel = isBottomRegion && columnIndex === -1;

  if (isRowCountLabel) {
    return {
      type: RegionType.RowCountLabel,
      x: 0,
      y: height - columnStatisticHeight,
      width: coordInstance.columnInitSize,
      height: columnStatisticHeight,
    };
  }

  if (isColumnStatistic) {
    const { scrollLeft } = scrollState;

    return {
      type: RegionType.ColumnStatistic,
      x: coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft),
      y: height - columnStatisticHeight,
      width: coordInstance.getColumnWidth(columnIndex),
      height: columnStatisticHeight,
    };
  }

  return null;
};

const checkIsColumnStatistic = (props: ICheckRegionProps): IRegionData | null => {
  return getColumnStatisticData(props);
};

const checkIsAllCheckbox = (props: ICheckRegionProps): IRegionData | null => {
  const { position, theme, rowControls, coordInstance, isMultiSelectionEnable } = props;
  const { x, y, rowIndex, columnIndex } = position;
  if (
    !isMultiSelectionEnable ||
    rowIndex !== -1 ||
    columnIndex !== -1 ||
    !rowControls.some((item) => item.type === RowControlType.Checkbox)
  ) {
    return null;
  }
  const { iconSizeXS } = theme;
  const halfIconSize = iconSizeXS / 2;
  const { rowInitSize, columnInitSize } = coordInstance;
  const minX = columnInitSize / 2 - halfIconSize;
  const minY = rowInitSize / 2 - halfIconSize;
  if (inRange(x, minX, minX + iconSizeXS) && inRange(y, minY, minY + iconSizeXS)) {
    return {
      type: RegionType.AllCheckbox,
      x: minX,
      y: minY,
      width: iconSizeXS,
      height: iconSizeXS,
    };
  }
  return null;
};

const checkIsAppendRow = (props: ICheckRegionProps): IRegionData | null => {
  const { position, getLinearRow } = props;
  const { rowIndex, columnIndex } = position;
  if (columnIndex >= -1 && rowIndex > -1) {
    const { type } = getLinearRow(rowIndex);

    if (type !== LinearRowType.Append) return null;

    return { ...BLANK_REGION_DATA, type: RegionType.AppendRow };
  }
  return null;
};

const checkIsRowHeader = (props: ICheckRegionProps): IRegionData | null => {
  const { position, theme, rowControls, scrollState, coordInstance } = props;
  const { x, y, rowIndex, columnIndex } = position;

  if (rowIndex <= -1 || columnIndex !== -1) return null;

  const linearRow = props.getLinearRow(rowIndex);

  if (linearRow.type === LinearRowType.Group) {
    return { ...BLANK_REGION_DATA, type: RegionType.RowGroupControl };
  }

  if (linearRow.type !== LinearRowType.Row) return null;

  const { iconSizeXS } = theme;
  const { scrollTop } = scrollState;
  const { columnInitSize } = coordInstance;
  const halfIconSize = iconSizeXS / 2;
  const controlSize = columnInitSize / (rowControls.length || 1);
  const offsetY = coordInstance.getRowOffset(rowIndex) - scrollTop;

  for (let i = 0; i < rowControls.length; i++) {
    const type = rowControls[i].type;
    const regionType = rowControlDefinitions[type];
    if (!rowControls.some((item) => item.type === type)) continue;

    const minX = controlSize * (i + 0.5) - halfIconSize;
    const minY = offsetY + rowHeadIconPaddingTop;
    const inControlXRange = inRange(x, minX, minX + iconSizeXS);
    const inYRangeRowHeader = inRange(y, minY, minY + iconSizeXS);

    if (regionType && inControlXRange && inYRangeRowHeader) {
      return {
        type: regionType,
        x: minX,
        y: minY,
        width: iconSizeXS,
        height: iconSizeXS,
      };
    }
  }

  return { ...BLANK_REGION_DATA, type: RegionType.RowHeader };
};

const checkIsRowGroupHeader = (props: ICheckRegionProps): IRegionData | null => {
  const { position, scrollState, coordInstance, getLinearRow } = props;
  const { scrollLeft } = scrollState;
  const { x, y, rowIndex, columnIndex } = position;
  if (rowIndex <= -1 || columnIndex !== 0) return null;

  const { type } = getLinearRow(rowIndex);

  if (type !== LinearRowType.Group) return null;

  const columnWidth = coordInstance.getColumnWidth(columnIndex);
  const columnOffsetX = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);

  if (inRange(x, columnOffsetX, columnOffsetX + columnWidth)) {
    return {
      type: RegionType.RowGroupHeader,
      x: columnOffsetX,
      y,
      width: columnWidth,
      height: groupHeaderHeight,
    };
  }
  return null;
};

// const checkIsFillHandler = (props: ICheckRegionProps): IRegionData | null => {
//   const { position, selection, coordInstance: c, scrollState } = props;
//   const { isCellSelection, ranges } = selection;
//   const { scrollLeft, scrollTop } = scrollState;
//   const { x, y, rowIndex, columnIndex } = position;
//   if (!isCellSelection || rowIndex < 0 || columnIndex < 0) return null;
//   const [startColIndex, startRowIndex] = ranges[0];
//   const [endColIndex, endRowIndex] = ranges[1];
//   const maxColIndex = Math.max(startColIndex, endColIndex);
//   const maxRowIndex = Math.max(startRowIndex, endRowIndex);
//   const handlerOffsetX =
//     c.getColumnRelativeOffset(maxColIndex, scrollLeft) + c.getColumnWidth(maxColIndex);
//   const handlerOffsetY = c.getRowOffset(maxRowIndex) + c.getRowHeight(maxRowIndex) - scrollTop;
//   const halfSize = fillHandlerSize / 2 + 3;

//   const minX = handlerOffsetX - halfSize;
//   const minY = handlerOffsetY - halfSize;
//   if (inRange(x, minX, minX + halfSize * 2) && inRange(y, minY, minY + halfSize * 2)) {
//     return {
//       type: RegionType.FillHandler,
//       x: minX,
//       y: minY,
//       width: halfSize * 2,
//       height: halfSize * 2,
//     };
//   }
//   return null;
// };

const checkIsCell = (props: ICheckRegionProps): IRegionData | null => {
  const { coordInstance, position, scrollState, getLinearRow } = props;
  const { rowIndex, columnIndex } = position;
  const { scrollLeft, scrollTop } = scrollState;
  if (rowIndex > -1 && columnIndex > -1) {
    const linearRow = getLinearRow(rowIndex);

    if (linearRow.type !== LinearRowType.Row) return null;

    const x = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
    const y = coordInstance.getRowOffset(rowIndex) - scrollTop;
    const width = coordInstance.getColumnWidth(columnIndex);
    const height = coordInstance.rowHeight;
    return {
      type: RegionType.Cell,
      x,
      y,
      width,
      height,
    };
  }
  return null;
};

// eslint-disable-next-line sonarjs/cognitive-complexity
const checkIsColumnHeader = (props: ICheckRegionProps): IRegionData | null => {
  const {
    position,
    scrollState,
    coordInstance,
    columns,
    theme,
    isColumnResizable,
    isColumnHeaderMenuVisible,
  } = props;

  const { x, y, rowIndex, columnIndex } = position;
  const { iconSizeXS } = theme;

  if (rowIndex === -1 && columnIndex > -1) {
    const { scrollLeft } = scrollState;
    const { rowInitSize } = coordInstance;
    const { isPrimary, description, hasMenu: hasColumnMenu } = columns[columnIndex];
    const hasMenu = hasColumnMenu && isColumnHeaderMenuVisible;
    const width = coordInstance.getColumnWidth(columnIndex);
    const startOffsetX = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
    const endOffsetX = startOffsetX + width;
    const columnMenuX = hasMenu ? endOffsetX - columnHeadPadding / 2 - iconSizeXS : endOffsetX;

    if (hasMenu && inRange(x, columnMenuX, columnMenuX + iconSizeXS)) {
      return {
        type: RegionType.ColumnHeaderMenu,
        x: startOffsetX,
        y: 0,
        width: iconSizeXS,
        height: rowInitSize,
      };
    }

    const descriptionX = columnMenuX - iconSizeXS - columnHeadPadding / 2;
    const descriptionY = (rowInitSize - iconSizeXS) / 2;
    if (
      description &&
      inRange(x, descriptionX, descriptionX + iconSizeXS) &&
      inRange(y, descriptionY, descriptionY + iconSizeXS)
    ) {
      return {
        type: RegionType.ColumnDescription,
        x: descriptionX,
        y: descriptionY,
        width: iconSizeXS,
        height: iconSizeXS,
      };
    }

    const primaryIconX = startOffsetX + iconSizeXS / 2;
    const primaryIconY = (rowInitSize - iconSizeXS) / 2;

    if (
      isPrimary &&
      inRange(x, primaryIconX, primaryIconX + iconSizeXS) &&
      inRange(y, primaryIconY, primaryIconY + iconSizeXS)
    ) {
      return {
        type: RegionType.ColumnPrimaryIcon,
        x: primaryIconX,
        y: primaryIconY,
        width: iconSizeXS,
        height: iconSizeXS,
      };
    }

    if (
      isColumnResizable &&
      ((columnIndex !== 0 &&
        inRange(x, startOffsetX, startOffsetX + columnResizeHandlerWidth / 2)) ||
        inRange(x, endOffsetX - columnResizeHandlerWidth / 2, endOffsetX))
    ) {
      return { ...BLANK_REGION_DATA, type: RegionType.ColumnResizeHandler };
    }

    return {
      type: RegionType.ColumnHeader,
      x: startOffsetX,
      y: 0,
      width,
      height: rowInitSize,
    };
  }
  return null;
};
