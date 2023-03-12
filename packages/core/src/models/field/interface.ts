import type { Column, IFieldVo } from './field';

export type IColumnMeta = { [viewId: string]: Column };

export interface IFieldSnapshot {
  field: IFieldVo;
  columnMeta: IColumnMeta;
}
