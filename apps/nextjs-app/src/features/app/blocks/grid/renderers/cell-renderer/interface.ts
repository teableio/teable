import type Konva from 'konva';
import type { CSSProperties, ForwardRefRenderFunction } from 'react';
import type { IEditorProps, IEditorRef } from '../../components';
import type { IGridTheme } from '../../configs';
import type { IRectangle } from '../../interface';

export enum CellType {
  Loading = 'Loading',
  Url = 'Url',
  Text = 'Text',
  Date = 'Date',
  Number = 'Number',
  Select = 'Select',
}

export enum EditorType {
  Text = 'Text',
  Number = 'Number',
  Select = 'Select',
  Custom = 'Custom',
}

type ICustomEditor = ForwardRefRenderFunction<IEditorRef, IEditorProps>;

export interface IBaseCell {
  readonly readonly?: boolean;
  readonly cursor?: CSSProperties['cursor'];
  readonly contentAlign?: 'left' | 'right' | 'center';
  readonly themeOverride?: IGridTheme;
  readonly customEditor?: ICustomEditor;
}

export interface ILoadingCell extends IBaseCell {
  readonly type: CellType.Loading;
}

export interface ITextCell extends IBaseCell {
  readonly type: CellType.Text;
  readonly data: string;
  readonly displayData: string;
}

export interface IDateCell extends IBaseCell {
  readonly type: CellType.Date;
  readonly data: string;
  readonly displayData: string;
}

export interface IUrlCell extends IBaseCell {
  readonly type: CellType.Url;
  readonly data: string;
  readonly displayData: string;
}

export interface INumberCell extends IBaseCell {
  readonly type: CellType.Number;
  readonly data: number | null | undefined;
  readonly displayData: string;
}

export interface ISelectChoice {
  id?: string;
  name: string;
  bgColor?: string;
  textColor?: string;
}

export interface ISelectCell extends IBaseCell {
  readonly type: CellType.Select;
  readonly data: string[];
  readonly choices?: ISelectChoice[];
  readonly displayData?: string;
  readonly isMultiple?: boolean;
}

export type IInnerCell = ITextCell | INumberCell | ISelectCell | IUrlCell | IDateCell;

export type ICell = IInnerCell | ILoadingCell;

export type ICellRenderProps = {
  ctx: Konva.Context;
  rect: IRectangle;
  theme: IGridTheme;
};

export interface IBaseCellRenderer<T extends ICell> {
  // Rendering
  readonly type: T['type'];
  readonly draw: (cell: T, props: ICellRenderProps) => void;
  readonly needsHover?: boolean;
  readonly needsHoverPosition?: boolean;

  // Editing
  readonly provideEditor?: IProvideEditorCallback<T>;
}

export type IProvideEditorCallback<T extends ICell> = (cell: T) => void;

export interface IInternalCellRenderer<T extends ICell> extends IBaseCellRenderer<T> {
  readonly getAccessibilityString?: (cell: T) => string;
  readonly onPaste?: (val: string, cell: T) => T | undefined;
}
