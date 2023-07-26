import type { CSSProperties, ForwardRefRenderFunction } from 'react';
import type { IEditorProps, IEditorRef } from '../../components';
import type { IGridTheme } from '../../configs';
import type { IRectangle } from '../../interface';
import type { ImageManager } from '../../managers';

export enum CellType {
  Text = 'Text',
  Url = 'Url',
  Number = 'Number',
  Select = 'Select',
  Image = 'Image',
  Boolean = 'Boolean',
  Loading = 'Loading',
}

export enum EditorType {
  Text = 'Text',
  Number = 'Number',
  Select = 'Select',
  Custom = 'Custom',
}

export enum EditorPosition {
  Above = 'Above',
  Overlap = 'Overlap',
  Below = 'Below',
}

export type ICustomEditor = ForwardRefRenderFunction<IEditorRef, IEditorProps>;

export interface IBaseCell {
  readonly?: boolean;
  cursor?: CSSProperties['cursor'];
  contentAlign?: 'left' | 'right' | 'center';
  lastUpdated?: string;
  customTheme?: Partial<IGridTheme>;
}

export interface IEditableCell extends IBaseCell {
  customEditor?: ICustomEditor;
  editorPosition?: EditorPosition;
}

export interface ILoadingCell extends IBaseCell {
  type: CellType.Loading;
}

export interface ITextCell extends IEditableCell {
  type: CellType.Text;
  data: string;
  displayData: string;
}

export interface INumberCell extends IEditableCell {
  type: CellType.Number;
  data: number | null | undefined;
  displayData: string;
}

export interface IBooleanCell extends IEditableCell {
  type: CellType.Boolean;
  data: boolean;
  isMultiple?: boolean;
}

export interface ISelectChoice {
  id?: string;
  name: string;
  bgColor?: string;
  textColor?: string;
}

export interface ISelectCell extends IEditableCell {
  type: CellType.Select;
  data: string[];
  choices?: ISelectChoice[];
  displayData?: string;
  isMultiple?: boolean;
}

export interface IImageData {
  id: string;
  url: string;
}

export interface IImageCell extends IEditableCell {
  type: CellType.Image;
  data: IImageData[];
  displayData: string[];
}

export type IInnerCell = ITextCell | INumberCell | ISelectCell | IImageCell | IBooleanCell;

export type ICell = IInnerCell | ILoadingCell;

export type ICellRenderProps = {
  ctx: CanvasRenderingContext2D;
  theme: IGridTheme;
  rect: IRectangle;
  columnIndex: number;
  rowIndex: number;
  imageManager: ImageManager;
  isActive?: boolean;
};

export interface ICellClickProps {
  width: number;
  height: number;
  hoverCellX: number;
  hoverCellY: number;
  theme: IGridTheme;
}

export interface ICellMeasureProps {
  ctx: CanvasRenderingContext2D;
  theme: IGridTheme;
  width: number;
}

export interface IBaseCellRenderer<T extends ICell> {
  // Rendering
  type: T['type'];
  draw: (cell: T, props: ICellRenderProps) => void;
  needsHover?: boolean;
  needsHoverPosition?: boolean;
  measure?: (cell: T, props: ICellMeasureProps) => number | null;

  // Interaction
  checkWithinBound?: (props: ICellClickProps) => boolean;
  onClick?: (cell: T, props: ICellClickProps) => void;

  // Editing
  provideEditor?: IProvideEditorCallback<T>;
}

export type IProvideEditorCallback<T extends ICell> = (cell: T) => void;

export interface IInternalCellRenderer<T extends ICell> extends IBaseCellRenderer<T> {
  getAccessibilityString?: (cell: T) => string;
  onPaste?: (val: string, cell: T) => T | undefined;
}
