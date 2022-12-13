import type { FieldType } from './constant';

type IDataType = string | number | boolean | Date | Array<IDataType>;

// table schema start here
export interface IFieldBase {
  id: string;
  name: string;
  type: FieldType;
  description?: string;
  property?: unknown;
  // for lookup field, it is a dynamic value
  calculatedType: unknown;
  // cellValue type enum (string, number, boolean, datetime, array)
  dataType: IDataType;
  notNull?: boolean;
  unique?: boolean;
  isPrimaryField?: boolean;
  defaultValue?: unknown;
}

export interface ISingleLineTextField extends IFieldBase {
  type: FieldType.SingleLineText;
  defaultValue: string;
}

export interface INumberField extends IFieldBase {
  type: FieldType.Number;
  defaultValue: number;
}

export interface ISingleSelectField extends IFieldBase {
  type: FieldType.SingleSelect;
  options: string[];
  defaultValue: string;
}

export interface IMultipleSelectField extends IFieldBase {
  type: FieldType.MultipleSelect;
  options: string[];
  defaultValue: string[];
}

export interface ICheckboxField extends IFieldBase {
  type: FieldType.Checkbox;
  defaultValue: boolean;
}

export interface IDateField extends IFieldBase {
  type: FieldType.Date;
  defaultValue: number;
}

export interface ICreatedByField extends IFieldBase {
  type: FieldType.CreatedBy;
  defaultValue: string;
}

export interface ILastModifiedByField extends IFieldBase {
  type: FieldType.LastModifiedBy;
  defaultValue: string;
}

export interface ICreatedTimeField extends IFieldBase {
  type: FieldType.CreatedTime;
  defaultValue: number;
}

export interface ILastModifiedTimeField extends IFieldBase {
  type: FieldType.LastModifiedTime;
  defaultValue: number;
}

export type IField =
  | ISingleLineTextField
  | INumberField
  | ISingleSelectField
  | IMultipleSelectField
  | ICheckboxField
  | IDateField
  | ICreatedByField
  | ILastModifiedByField
  | ICreatedTimeField
  | ILastModifiedTimeField;
