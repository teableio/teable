import type { IFieldVo } from '../field';
import type { IRecord } from '../record';
import type { IViewVo } from '../view';

export interface ICreateTableRo {
  name: string;
  description?: string;
}

export interface ITableVo extends ICreateTableRo {
  id: string;
}

export interface ITableSnapshot {
  table: ITableVo;
  order: number;
}

export interface IFullSsrSnapshot {
  recordData: {
    records: IRecord[];
    total: number;
  };

  tables: ITableVo[];

  views: IViewVo[];

  fields: IFieldVo[];
}
