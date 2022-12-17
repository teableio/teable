import type { FieldType } from './constant';

export interface IFieldBase {
  id: string;
  name: string;
  type: FieldType;
  description?: string;
  options?: unknown;
  notNull?: boolean;
  unique?: boolean;
  isPrimaryField?: boolean;
  defaultValue?: unknown;
}
