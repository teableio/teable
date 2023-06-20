import type { CustomCell } from '@glideapps/glide-data-grid';
import type {
  DateFieldOptions,
  FieldType,
  IAttachmentCellValue,
  SelectFieldOptions,
} from '@teable-group/core';

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

export interface IDateGridCell {
  type: FieldType.Date;
  value: string;
  options?: DateFieldOptions;
}

export interface ILoadingGridCell {
  type: 'loading';
}

export type IGridCell = ISelectGridCell | IAttachmentGridCell | ILoadingGridCell | IDateGridCell;

export type ICustomCellGridCell = CustomCell<IGridCell>;
