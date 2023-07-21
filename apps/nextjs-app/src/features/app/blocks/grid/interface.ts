import type { IGridTheme } from './configs';
export * from './renderers/cell-renderer/interface';

export interface IScrollState {
  scrollTop: number;
  scrollLeft: number;
  isScrolling: boolean;
}

export interface IPosition {
  x: number;
  y: number;
}

export interface IRegionPosition extends IPosition {
  rowIndex: number;
  columnIndex: number;
}

export interface IRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export enum SelectionRegionType {
  Rows = 'Rows',
  Columns = 'Columns',
  Cells = 'Cells',
  None = 'None',
}

export enum RegionType {
  Cell = 'Cell',
  RowHeader = 'RowHeader',
  ColumnHeader = 'ColumnHeader',
  AppendRow = 'AppendRow',
  AppendColumn = 'AppendColumn',
  ColumnHeaderMenu = 'ColumnHeaderMenu',
  ColumnResizeHandler = 'ColumnResizeHandler',
  RowHeaderDragHandler = 'RowHeaderDragHandler',
  RowHeaderExpandHandler = 'RowHeaderExpandHandler',
  RowHeaderCheckbox = 'RowHeaderCheckbox',
  AllCheckbox = 'AllCheckbox',
  FillHandler = 'FillHandler',
  Blank = 'Blank',
  None = 'None',
}

export type IRange = [number, number];

export interface ISelectionBase {
  type: SelectionRegionType;
  ranges: IRange[];
}

export interface ISelectionState extends ISelectionBase {
  isSelecting: boolean;
}

export interface IMouseState extends IRegionPosition {
  type: RegionType;
  hoverCellX: number;
  hoverCellY: number;
  isOutOfBounds: boolean;
}

enum RowType {
  Blank,
  Cell,
  Append,
  GroupHeader,
}

interface IRowBase {
  type: RowType;
}

interface ICellRow extends IRowBase {
  type: RowType.Cell;
}

interface IAppendRow extends IRowBase {
  type: RowType.Append;
}

interface IBlankRow extends IRowBase {
  type: RowType.Blank;
}

interface IGroupHeaderRow extends IRowBase {
  type: RowType.GroupHeader;
}

export interface IGridColumn {
  id?: string;
  width?: number;
  name: string;
  icon?: string;
  disabled?: boolean;
  hasMenu?: boolean;
  themeOverride?: IGridTheme;
}

export type ILinearRow = ICellRow | IAppendRow | IGroupHeaderRow | IBlankRow;

export interface IColumnResizeState {
  columnIndex: number;
  width: number;
  x: number;
}

export interface IDragState {
  type: DragRegionType;
  delta: number;
  index: number;
  isDragging: boolean;
}

export enum DragRegionType {
  Row = 'Row',
  Column = 'Column',
  None = 'None',
}

export type IScrollDirection = -1 | 0 | 1;

export enum MouseButtonType {
  Left = 0,
  Center = 1,
  Right = 2,
}

export enum RowControlType {
  Drag = 'Drag',
  Expand = 'Expand',
  Checkbox = 'Checkbox',
}

export type ICellItem = [colIndex: number, rowIndex: number];

export interface IPositionWithBounds {
  bounds: IRectangle;
  eventPosition: IPosition;
}
