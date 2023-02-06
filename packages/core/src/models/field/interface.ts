import type { Column, FieldBase } from './field';

export type IColumnMeta = { [key: string]: Column };

export interface IFieldSnapshot {
  field: FieldBase;
  columnMeta: IColumnMeta;
}
