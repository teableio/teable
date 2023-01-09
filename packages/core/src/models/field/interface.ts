import type { StatisticsFunc } from '../view';
import type { FieldType } from './constant';

export interface IFieldBase {
  id: string;
  name: string;
  type: FieldType;
  description?: string;
  options?: unknown;
  notNull?: boolean;
  unique?: boolean;
  isPrimary?: boolean;
  defaultValue?: unknown;
}

export interface IColumn {
  order: number;
  width?: number;
  hidden?: boolean;
  statisticFunc?: StatisticsFunc;
}

export interface IColumnMeta {
  [viewId: string]: IColumn;
}

export interface IFieldSnapshot {
  field: IFieldBase;
  columnMeta: IColumnMeta;
}
