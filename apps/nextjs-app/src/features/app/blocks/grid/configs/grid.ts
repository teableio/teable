import { DragRegionType, RegionType } from '../interface';

export const GRID_CONTAINER_ID = '__t_grid_container_id';

/* eslint-disable @typescript-eslint/naming-convention */
export const GRID_DEFAULT = {
  // Row
  rowHeight: 32,
  rowHeadWidth: 70,
  rowHeadIconPaddingTop: 8,
  appendRowHeight: 32,

  // Column
  columnWidth: 150,
  columnHeadHeight: 32,
  columnHeadMenuSize: 12,
  columnHeadMenuClickableSize: 20,
  columnHeadPadding: 8,
  columnAppendBtnWidth: 100,
  columnResizeHandlerWidth: 5,

  // Cell
  cellHorizontalPadding: 8,
  cellVerticalPadding: 10,
  cellTextLineHeight: 22,
  fillHandlerSize: 5,

  // Statistics
  columnStatisticHeight: 40,

  // Others
  scrollBuffer: 100,
  cellScrollBuffer: 16,
};

export const DEFAULT_MOUSE_STATE = {
  x: 0,
  y: 0,
  rowIndex: -Infinity,
  columnIndex: -Infinity,
  type: RegionType.None,
  isOutOfBounds: true,
};

export const DEFAULT_SCROLL_STATE = {
  scrollTop: 0,
  scrollLeft: 0,
  isScrolling: false,
};

export const DEFAULT_COLUMN_RESIZE_STATE = {
  columnIndex: -1,
  width: 0,
  x: 0,
};

export const DEFAULT_DRAG_STATE = {
  type: DragRegionType.None,
  ranges: [],
  delta: 0,
  isDragging: false,
};

export const ROW_RELATED_REGIONS = new Set([
  RegionType.Cell,
  RegionType.RowHeader,
  RegionType.RowHeaderCheckbox,
  RegionType.RowHeaderDragHandler,
  RegionType.RowHeaderExpandHandler,
]);
