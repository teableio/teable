import type { CustomCell } from '@glideapps/glide-data-grid';
import type {
  IDateFieldOptions,
  FieldType,
  IAttachmentCellValue,
  ISelectFieldOptions,
} from '@teable-group/core';

export interface ISelectGridCell {
  type: FieldType.SingleSelect | FieldType.MultipleSelect | FieldType.Link;
  value: string[];
  options?: ISelectFieldOptions;
}

export interface IAttachmentGridCell {
  type: FieldType.Attachment;
  value: IAttachmentCellValue;
  options: null;
}

export interface IDateGridCell {
  type: FieldType.Date;
  value: string;
  options?: IDateFieldOptions;
}

export interface ILoadingGridCell {
  type: 'loading';
}

export type IGridCell = ISelectGridCell | IAttachmentGridCell | ILoadingGridCell | IDateGridCell;

export type ICustomCellGridCell = CustomCell<IGridCell>;
