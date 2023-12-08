/* eslint-disable @typescript-eslint/naming-convention */
import { GRID_DEFAULT } from '../configs';
import { RegionType, RowControlType } from '../interface';
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
  > {
  rowControls: IRowControlItem[];
  isOutOfBounds: boolean;
  position: IRegionPosition;
  hasAppendRow: boolean;
  hasAppendColumn: boolean;
  hasColumnHeaderMenu: boolean;
  hasColumnResizeHandler: boolean;
  activeCell: ICellItem | null;
  activeCellBound: IActiveCellBound | null;
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
  columnHeadPadding,
  columnHeadMenuClickableSize,
  columnResizeHandlerWidth,
  fillHandlerSize,
  rowHeadIconPaddingTop,
  columnStatisticHeight,
} = GRID_DEFAULT;

export const getRegionData = (props: ICheckRegionProps): IRegionData => {
  return (
    checkIsActiveCell(props) ||
    checkIsOutOfBounds(props) ||
    checkIfSelecting(props) ||
    checkIfColumnResizing(props) ||
    checkIfDragging(props) ||
    checkIsAppendColumn(props) ||
    checkIsColumnStatistic(props) ||
    checkIsAllCheckbox(props) ||
    checkIsAppendRow(props) ||
    checkIsRowHeader(props) ||
    checkIsFillHandler(props) ||
    checkIsCell(props) ||
    checkIsColumnHeader(props) ||
    BLANK_REGION_DATA
  );
};

const checkIsActiveCell = (props: ICheckRegionProps): IRegionData | null => {
  const { coordInstance, scrollState, position, activeCell, activeCellBound } = props;
  if (activeCell == null || activeCellBound == null) return null;
  const { x, y } = position;
  const { scrollTop, scrollLeft } = scrollState;
  const [columnIndex, rowIndex] = activeCell;
  const offsetY = coordInstance.getRowOffset(rowIndex) - scrollTop;
  const offsetX = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
  const { width, height } = activeCellBound;

  if (inRange(x, offsetX, offsetX + width) && inRange(y, offsetY, offsetY + height)) {
    return {
      type: RegionType.ActiveCell,
      x: offsetX,
      y: offsetY,
      width,
      height,
      rowIndex,
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

const checkIsAppendColumn = (props: ICheckRegionProps): IRegionData | null => {
  const { position, hasAppendColumn } = props;
  const { rowIndex, columnIndex } = position;
  if (hasAppendColumn && rowIndex >= -1 && columnIndex === -2) {
    return { ...BLANK_REGION_DATA, type: RegionType.AppendColumn };
  }
  return null;
};

const checkIsColumnStatistic = (props: ICheckRegionProps): IRegionData | null => {
  const { position, columnStatistics, height, scrollState, coordInstance } = props;
  if (columnStatistics == null) return null;
  const { y, columnIndex } = position;
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
  const { position, coordInstance, hasAppendRow } = props;
  const { rowIndex, columnIndex } = position;
  const { rowCount } = coordInstance;
  if (hasAppendRow && rowIndex === rowCount - 1 && columnIndex >= -1) {
    return { ...BLANK_REGION_DATA, type: RegionType.AppendRow };
  }
  return null;
};

const checkIsRowHeader = (props: ICheckRegionProps): IRegionData | null => {
  const { position, theme, rowControls, scrollState, coordInstance } = props;
  const { x, y, rowIndex, columnIndex } = position;

  if (rowIndex <= -1 || columnIndex !== -1) return null;

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

const checkIsFillHandler = (props: ICheckRegionProps): IRegionData | null => {
  const { position, selection, coordInstance: c, scrollState } = props;
  const { isCellSelection, ranges } = selection;
  const { scrollLeft, scrollTop } = scrollState;
  const { x, y, rowIndex, columnIndex } = position;
  if (!isCellSelection || rowIndex < 0 || columnIndex < 0) return null;
  const [startColIndex, startRowIndex] = ranges[0];
  const [endColIndex, endRowIndex] = ranges[1];
  const maxColIndex = Math.max(startColIndex, endColIndex);
  const maxRowIndex = Math.max(startRowIndex, endRowIndex);
  const handlerOffsetX =
    c.getColumnRelativeOffset(maxColIndex, scrollLeft) + c.getColumnWidth(maxColIndex);
  const handlerOffsetY = c.getRowOffset(maxRowIndex) + c.getRowHeight(maxRowIndex) - scrollTop;
  const halfSize = fillHandlerSize / 2 + 3;

  const minX = handlerOffsetX - halfSize;
  const minY = handlerOffsetY - halfSize;
  if (inRange(x, minX, minX + halfSize * 2) && inRange(y, minY, minY + halfSize * 2)) {
    return {
      type: RegionType.FillHandler,
      x: minX,
      y: minY,
      width: halfSize * 2,
      height: halfSize * 2,
    };
  }
  return null;
};

const checkIsCell = (props: ICheckRegionProps): IRegionData | null => {
  const { coordInstance, position, scrollState } = props;
  const { rowIndex, columnIndex } = position;
  const { scrollLeft, scrollTop } = scrollState;
  if (rowIndex > -1 && columnIndex > -1) {
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

const checkIsColumnHeader = (props: ICheckRegionProps): IRegionData | null => {
  const {
    position,
    scrollState,
    coordInstance,
    columns,
    theme,
    hasColumnHeaderMenu,
    hasColumnResizeHandler,
  } = props;

  const { x, y, rowIndex, columnIndex } = position;
  const { iconSizeXS } = theme;

  if (rowIndex === -1 && columnIndex > -1) {
    const { scrollLeft } = scrollState;
    const { rowInitSize } = coordInstance;

    const { description, hasMenu } = columns[columnIndex];
    const width = coordInstance.getColumnWidth(columnIndex);
    const startOffsetX = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
    const endOffsetX = startOffsetX + width;
    const columnMenuX = hasMenu
      ? endOffsetX - columnHeadPadding / 2 - columnHeadMenuClickableSize
      : endOffsetX;

    if (
      hasMenu &&
      hasColumnHeaderMenu &&
      inRange(x, columnMenuX, columnMenuX + columnHeadMenuClickableSize)
    ) {
      return {
        type: RegionType.ColumnHeaderMenu,
        x: startOffsetX,
        y: 0,
        width: columnHeadMenuClickableSize,
        height: rowInitSize,
      };
    }

    const descriptionX = columnMenuX - iconSizeXS - 4;
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

    if (
      hasColumnResizeHandler &&
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
