import type { SelectFieldOptions } from '@teable-group/core';
import type Konva from 'konva';
import type { CSSProperties } from 'react';
import type { IGridTheme } from '../../configs';
import type { IRectangle } from '../../interface';

export enum CellType {
  Text = 'Text',
  Url = 'Url',
  Number = 'Number',
  Select = 'Select',
}

export interface IBaseCell {
  readonly contentAlign?: 'left' | 'right' | 'center';
  readonly cursor?: CSSProperties['cursor'];
}

export interface ITextCell extends IBaseCell {
  readonly type: CellType.Text;
  readonly data: string;
  readonly displayData: string;
  readonly readonly?: boolean;
}

export interface IUrlCell extends IBaseCell {
  readonly type: CellType.Url;
  readonly data: string;
  readonly displayData: string;
  readonly readonly?: boolean;
}

export interface INumberCell extends IBaseCell {
  readonly type: CellType.Number;
  readonly data: number | null | undefined;
  readonly displayData: string;
  readonly readonly?: boolean;
}

export interface ISelectCellData {
  value: string[];
  options?: SelectFieldOptions;
}

export interface ISelectCell extends IBaseCell {
  readonly type: CellType.Select;
  readonly data: ISelectCellData;
  readonly displayData?: string;
  readonly readonly?: boolean;
  readonly isMultiple?: boolean;
}

export type IInnerCell = ITextCell | INumberCell | ISelectCell | IUrlCell;

export type ICellRenderProps = IRectangle & {
  theme: IGridTheme;
  ctx: Konva.Context;
};

export interface IBaseCellRenderer<T extends IInnerCell> {
  // Rendering
  readonly type: T['type'];
  readonly draw: (cell: T, props: ICellRenderProps) => void;
  readonly needsHover?: boolean;
  readonly needsHoverPosition?: boolean;

  // Editing
  readonly provideEditor?: IProvideEditorCallback<T>;
}

export type IProvideEditorCallback<T extends IInnerCell> = (cell: T) => void;

export interface IInternalCellRenderer<T extends IInnerCell> extends IBaseCellRenderer<T> {
  readonly getAccessibilityString?: (cell: T) => string;
  readonly onPaste?: (val: string, cell: T) => T | undefined;
}
