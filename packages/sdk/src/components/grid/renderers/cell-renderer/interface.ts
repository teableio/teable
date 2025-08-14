import type { IButtonFieldCellValue, IButtonFieldOptions } from '@teable/core';
import type { CSSProperties, ForwardRefRenderFunction } from 'react';
import type { IButtonClickStatus, IButtonClickStatusHook } from '../../../../hooks';
import type { IEditorProps, IEditorRef } from '../../components';
import type { IGridTheme } from '../../configs';
import type { IActiveCellBound, ICellPosition, IRectangle } from '../../interface';
import type { ImageManager, SpriteManager } from '../../managers';

export enum CellType {
  Text = 'Text',
  Link = 'Link',
  Number = 'Number',
  Select = 'Select',
  Image = 'Image',
  Chart = 'Chart',
  Rating = 'Rating',
  User = 'User',
  Boolean = 'Boolean',
  Loading = 'Loading',
  Button = 'Button',
}

export enum EditorType {
  Text = 'Text',
  Number = 'Number',
  Select = 'Select',
  Custom = 'Custom',
}

export type ICustomEditor = ForwardRefRenderFunction<IEditorRef, IEditorProps>;

export interface IBaseCell {
  id?: string;
  readonly?: boolean;
  cursor?: CSSProperties['cursor'];
  contentAlign?: 'left' | 'right' | 'center';
  lastUpdated?: string;
  customTheme?: Partial<IGridTheme>;
  locked?: boolean;
  hidden?: boolean;
}

export interface IEditableCell extends IBaseCell {
  editorWidth?: number;
  customEditor?: ICustomEditor;
}

export interface ILoadingCell extends IBaseCell {
  type: CellType.Loading;
}

export interface ITextCell extends IEditableCell {
  type: CellType.Text;
  data: string;
  displayData: string;
  isWrap?: boolean;
}

export interface ILinkCell extends IEditableCell {
  type: CellType.Link;
  data: string[];
  displayData: string;
  onClick?: (value: string) => void;
}

export enum NumberDisplayType {
  Ring = 'ring',
  Bar = 'bar',
}

export interface INumberShowAs {
  type: NumberDisplayType;
  color: string;
  maxValue: number;
  showValue: boolean;
}

export interface INumberCell extends IEditableCell {
  type: CellType.Number;
  data: number | null | undefined;
  displayData: string | string[];
  showAs?: INumberShowAs;
}

export enum ChartType {
  Bar = 'bar',
  Line = 'line',
}

export interface IChartCell extends IEditableCell {
  type: CellType.Chart;
  data: number[];
  displayData: string[];
  chartType?: ChartType;
  color?: string;
}

export interface IBooleanCell extends IEditableCell {
  type: CellType.Boolean;
  data: boolean;
  isMultiple?: boolean;
}

export interface IRatingCell extends IEditableCell {
  type: CellType.Rating;
  data: number;
  icon: string;
  color: string;
  max: number;
}

export interface ISelectChoice {
  id: string;
  name: string;
  color?: string;
  backgroundColor?: string;
}

export interface ISelectChoiceSorted {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface ISelectCell extends IEditableCell {
  type: CellType.Select;
  data: (string | { title: string; id: string })[];
  displayData: string[];
  choiceMap?: Record<string, ISelectChoice>;
  choiceSorted?: ISelectChoiceSorted[];
  isMultiple?: boolean;
  isEditingOnClick?: boolean;
  onPreview?: (activeId: string) => void;
}

export interface IImageData {
  id: string;
  url: string;
}

export interface IImageCell extends IEditableCell {
  type: CellType.Image;
  data: IImageData[];
  displayData: string[];
  onPreview?: (activeId: string) => void;
}

export interface IUserData {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface IUserCell extends IEditableCell {
  type: CellType.User;
  data: IUserData[];
  displayData?: string;
}

export interface IButtonCell extends IEditableCell {
  type: CellType.Button;
  data: {
    cellValue: IButtonFieldCellValue;
    fieldOptions: IButtonFieldOptions;
    tableId: string;
    statusHook?: IButtonClickStatusHook;
  };
}

export type IInnerCell =
  | ITextCell
  | ILinkCell
  | INumberCell
  | ISelectCell
  | IImageCell
  | IRatingCell
  | IBooleanCell
  | IChartCell
  | IUserCell
  | IButtonCell;

export type ICell = IInnerCell | ILoadingCell;

export type ICellRenderProps = {
  ctx: CanvasRenderingContext2D;
  theme: IGridTheme;
  rect: IRectangle;
  rowIndex: number;
  columnIndex: number;
  imageManager: ImageManager;
  spriteManager: SpriteManager;
  hoverCellPosition?: ICellPosition | null;
  isActive?: boolean;
};

export interface ICellClickProps {
  width: number;
  height: number;
  theme: IGridTheme;
  isActive: boolean;
  activeCellBound: IActiveCellBound | null;
  hoverCellPosition: ICellPosition;
}

export interface ICellMeasureProps {
  ctx: CanvasRenderingContext2D;
  theme: IGridTheme;
  width: number;
  height: number;
}

export interface ICellMeasureResult {
  width: number;
  height: number;
  totalHeight: number;
}

export enum CellRegionType {
  Blank = 'blank',
  Update = 'update',
  Preview = 'preview',
  ToggleEditing = 'toggleEditing',
  Hover = 'hover',
}

export interface ICellRegionWithBlank {
  type: CellRegionType.Blank;
}

export interface ICellRegionWithData {
  type:
    | CellRegionType.Update
    | CellRegionType.ToggleEditing
    | CellRegionType.Preview
    | CellRegionType.Blank
    | CellRegionType.Hover;
  data: unknown;
}

export type ICellRegion = ICellRegionWithData | ICellRegionWithBlank;

export type ICellClickCallback = (cellRegion: ICellRegionWithData) => void;

export interface IBaseCellRenderer<T extends ICell> {
  // Rendering
  type: T['type'];
  draw: (cell: T, props: ICellRenderProps) => void;
  needsHover?: boolean;
  needsHoverPosition?: boolean;
  needsHoverWhenActive?: boolean;
  needsHoverPositionWhenActive?: boolean;
  measure?: (cell: T, props: ICellMeasureProps) => ICellMeasureResult;

  // Interaction
  checkRegion?: (cell: T, props: ICellClickProps, shouldCalculate?: boolean) => ICellRegion;
  onClick?: (cell: T, props: ICellClickProps, callback: ICellClickCallback) => void;

  // Editing
  provideEditor?: IProvideEditorCallback<T>;
}

export type IProvideEditorCallback<T extends ICell> = (cell: T) => void;

export interface IInternalCellRenderer<T extends ICell> extends IBaseCellRenderer<T> {
  getAccessibilityString?: (cell: T) => string;
  onPaste?: (val: string, cell: T) => T | undefined;
}
