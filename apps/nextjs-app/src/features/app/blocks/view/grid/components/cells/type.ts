import type { CustomCell } from '@glideapps/glide-data-grid';
import type { FieldType, IAttachmentCellValue, SelectFieldOptions } from '@teable-group/core';

export interface ISelectGridCell {
  type: FieldType.SingleSelect | FieldType.MultipleSelect;
  value: string[];
  options: SelectFieldOptions;
}

export interface IAttachmentGridCell {
  type: FieldType.Attachment;
  value: IAttachmentCellValue;
  options: null;
}

export type IGridCell = ISelectGridCell | IAttachmentGridCell;

export type ICustomCellGridCell = CustomCell<IGridCell>;
