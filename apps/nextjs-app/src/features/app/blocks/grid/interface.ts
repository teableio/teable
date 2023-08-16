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

export type ICellRange = [colIndex: number, rowIndex: number];
export type IColumnRange = [colIndex: number, colIndex: number];
export type IRowRange = [rowIndex: number, rowIndex: number];
export type IRange = ICellRange | IColumnRange | IRowRange;

export interface IMouseState extends IRegionPosition {
  type: RegionType;
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

export type ILinearRow = ICellRow | IAppendRow | IGroupHeaderRow | IBlankRow;

export interface IGridColumn {
  id?: string;
  name: string;
  icon?: string;
  width?: number;
  hasMenu?: boolean;
  readonly?: boolean;
  customTheme?: Partial<IGridTheme>;
}

export interface IColumnResizeState {
  columnIndex: number;
  width: number;
  x: number;
}

export interface IDragState {
  type: DragRegionType;
  delta: number;
  ranges: IRange[];
  isDragging: boolean;
}

export enum DragRegionType {
  Rows = 'Rows',
  Columns = 'Columns',
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

export interface IRowControlItem {
  type: RowControlType;
  icon?: string;
}

export type ICellItem = [colIndex: number, rowIndex: number];

export type ICellPosition = [x: number, y: number];

export interface IPositionWithBounds {
  bounds: IRectangle;
  eventPosition: IPosition;
}
