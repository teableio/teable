import type { FieldType } from './constant';

type IDataType = string | number | boolean | Date | Array<IDataType>;

// table schema start here
export interface IFieldBase {
  id: string;
  name: string;
  type: FieldType;
  description?: string;
  options?: unknown;
  // for lookup field, it is a dynamic value
  calculatedType: unknown;
  // cellValue type enum (string, number, boolean, datetime, array)
  dataType: IDataType;
  notNull?: boolean;
  unique?: boolean;
  isPrimaryField?: boolean;
  defaultValue?: unknown;
}
