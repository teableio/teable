import type { CustomCell } from '@glideapps/glide-data-grid';
import type { FieldType, IAttachmentCellValue, SelectFieldOptions } from '@teable-group/core';

export interface ISelectGridCell {
  type: FieldType.SingleSelect | FieldType.MultipleSelect | FieldType.Link;
  value: string[];
  options?: SelectFieldOptions;
}

export interface IAttachmentGridCell {
  type: FieldType.Attachment;
  value: IAttachmentCellValue;
  options: null;
}

export interface ILoadingGridCell {
  type: 'loading';
}

export type IGridCell = ISelectGridCell | IAttachmentGridCell | ILoadingGridCell;

export type ICustomCellGridCell = CustomCell<IGridCell>;
