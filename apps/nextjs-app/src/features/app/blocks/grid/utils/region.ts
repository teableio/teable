import { GRID_DEFAULT } from '../configs';
import { RegionType, RowControlType, SelectionRegionType } from '../interface';
import type { IRegionPosition } from '../interface';
import type { IRenderLayerProps } from '../RenderLayer';
import { inRange } from './range';

interface ICheckRegionProps
  extends Pick<
    IRenderLayerProps,
    | 'theme'
    | 'rowControls'
    | 'scrollState'
    | 'dragState'
    | 'selectionState'
    | 'columnResizeState'
    | 'coordInstance'
  > {
  isOutOfBounds: boolean;
  position: IRegionPosition;
  hasAppendRow: boolean;
  hasAppendColumn: boolean;
}

export const getRegionType = (props: ICheckRegionProps): RegionType => {
  return (
    checkIsOutOfBounds(props) ||
    checkIfSelecting(props) ||
    checkIfColumnResizing(props) ||
    checkIfDragging(props) ||
    checkIsAppendColumn(props) ||
    checkIsAppendRow(props) ||
    checkIsRowHeader(props) ||
    checkIsFillHandler(props) ||
    checkIsCell(props) ||
    checkIsColumnHeader(props) ||
    RegionType.Blank
  );
};

const checkIsOutOfBounds = (props: ICheckRegionProps): RegionType | null => {
  const { isOutOfBounds } = props;
  return isOutOfBounds ? RegionType.Blank : null;
};

const checkIfSelecting = (props: ICheckRegionProps): RegionType | null => {
  const { isSelecting, type } = props.selectionState;
  return isSelecting && type === SelectionRegionType.Cells ? RegionType.Cell : null;
};

const checkIfColumnResizing = (props: ICheckRegionProps): RegionType | null => {
  const { columnIndex } = props.columnResizeState;
  return columnIndex > -1 ? RegionType.ColumnResizeHandler : null;
};

const checkIfDragging = (props: ICheckRegionProps): RegionType | null => {
  const { isDragging } = props.dragState;
  return isDragging ? RegionType.ColumnHeader : null;
};

const checkIsAppendColumn = (props: ICheckRegionProps): RegionType | null => {
  const { position, hasAppendColumn } = props;
  const { rowIndex, columnIndex } = position;
  return hasAppendColumn && rowIndex === -1 && columnIndex === -2 ? RegionType.AppendColumn : null;
};

const checkIsAppendRow = (props: ICheckRegionProps): RegionType | null => {
  const { position, coordInstance, hasAppendRow } = props;
  const { rowIndex, columnIndex } = position;
  const { rowCount } = coordInstance;
  return hasAppendRow && rowIndex === rowCount - 1 && columnIndex > -1
    ? RegionType.AppendRow
    : null;
};

const checkIsRowHeader = (props: ICheckRegionProps): RegionType | null => {
  const { position, theme, rowControls, scrollState, coordInstance } = props;
  const { x, y, rowIndex, columnIndex } = position;
  if (rowIndex >= -1 && columnIndex === -1) {
    if (!rowControls?.includes(RowControlType.Checkbox)) return RegionType.RowHeader;
    const { iconSizeXS } = theme;
    const { rowInitSize, columnInitSize } = coordInstance;
    const halfIconSize = iconSizeXS / 2;
    if (
      inRange(x, columnInitSize / 2 - halfIconSize, columnInitSize / 2 + halfIconSize) &&
      inRange(y, rowInitSize / 2 - halfIconSize, rowInitSize / 2 + halfIconSize)
    ) {
      return RegionType.AllCheckbox;
    }
    const { scrollTop } = scrollState;
    const offsetY = coordInstance.getRowOffset(rowIndex) - scrollTop;
    const rowHeight = coordInstance.getRowHeight(rowIndex);
    if (
      inRange(x, columnInitSize / 2 - halfIconSize, columnInitSize / 2 + halfIconSize) &&
      inRange(y, offsetY + rowHeight / 2 - halfIconSize, offsetY + rowHeight / 2 + halfIconSize)
    ) {
      return RegionType.RowHeaderCheckbox;
    }
    return RegionType.RowHeader;
  }
  return null;
};

const checkIsFillHandler = (props: ICheckRegionProps): RegionType | null => {
  const { position, selectionState, coordInstance: c, scrollState } = props;
  const { freezeColumnCount } = c;
  const { scrollLeft, scrollTop } = scrollState;
  const { x, y, rowIndex, columnIndex } = position;
  const { type: selectionType, ranges } = selectionState;
  const isCellSelection = selectionType === SelectionRegionType.Cells;
  if (!isCellSelection || rowIndex < 0 || columnIndex < 0) return null;
  const [startColIndex, startRowIndex] = ranges[0];
  const [endColIndex, endRowIndex] = ranges[1];
  const maxColIndex = Math.max(startColIndex, endColIndex);
  const maxRowIndex = Math.max(startRowIndex, endRowIndex);
  let handlerOffsetX = c.getColumnOffset(maxColIndex) + c.getColumnWidth(maxColIndex);
  handlerOffsetX = maxColIndex < freezeColumnCount ? handlerOffsetX : handlerOffsetX - scrollLeft;
  const handlerOffsetY = c.getRowOffset(maxRowIndex) + c.getRowHeight(maxRowIndex) - scrollTop;
  const halfSize = GRID_DEFAULT.fillHandlerSize / 2 + 3;

  if (
    inRange(x, handlerOffsetX - halfSize, handlerOffsetX + halfSize) &&
    inRange(y, handlerOffsetY - halfSize, handlerOffsetY + halfSize)
  ) {
    return RegionType.FillHandler;
  }
  return null;
};

const checkIsCell = (props: ICheckRegionProps): RegionType | null => {
  const { rowIndex, columnIndex } = props.position;
  return rowIndex > -1 && columnIndex > -1 ? RegionType.Cell : null;
};

const checkIsColumnHeader = (props: ICheckRegionProps): RegionType | null => {
  const { position, scrollState, coordInstance } = props;
  const { x, rowIndex, columnIndex } = position;
  if (rowIndex === -1 && columnIndex > -1) {
    const { scrollLeft } = scrollState;
    const { freezeColumnCount } = coordInstance;
    const { columnHeadPadding, columnHeadMenuClickableSize, columnResizeHandlerWidth } =
      GRID_DEFAULT;
    const width = coordInstance.getColumnWidth(columnIndex);
    const startOffsetX = coordInstance.getColumnOffset(columnIndex);
    const endOffsetX = startOffsetX + width;
    const clientX = columnIndex < freezeColumnCount ? x : scrollLeft + x;
    if (
      inRange(
        clientX,
        endOffsetX - columnHeadPadding / 2 - columnHeadMenuClickableSize,
        endOffsetX - columnHeadPadding / 2
      )
    ) {
      return RegionType.ColumnHeaderMenu;
    }
    if (
      (columnIndex !== 0 &&
        inRange(clientX, startOffsetX, startOffsetX + columnResizeHandlerWidth / 2)) ||
      inRange(clientX, endOffsetX - columnResizeHandlerWidth / 2, endOffsetX)
    ) {
      return RegionType.ColumnResizeHandler;
    }
    return RegionType.ColumnHeader;
  }
  return null;
};
