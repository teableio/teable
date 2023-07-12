import { DragRegionType, RegionType, SelectionRegionType } from '../interface';

/* eslint-disable @typescript-eslint/naming-convention */
export const GRID_DEFAULT = {
  // Row
  rowHeight: 32,
  rowHeadWidth: 70,

  // Column
  columnWidth: 150,
  columnHeadHeight: 40,
  columnHeadMenuSize: 12,
  columnHeadMenuClickableSize: 20,
  columnHeadPadding: 8,
  columnAppendBtnWidth: 100,
  columnResizeHandlerWidth: 5,

  // Cell
  cellPadding: 8,
  fillHandlerSize: 5,

  // Others
  scrollBuffer: 100,
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
  delta: 0,
  index: -1,
  isDragging: false,
};

export const DEFAULT_SELECTION_STATE = {
  type: SelectionRegionType.None,
  ranges: [],
  isSelecting: false,
};
