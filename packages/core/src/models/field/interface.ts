import type { Column, IFieldVo } from './field';

export type IColumnMeta = { [key: string]: Column };

export interface IFieldSnapshot {
  field: IFieldVo;
  columnMeta: IColumnMeta;
}
