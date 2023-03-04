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

export interface ITableSSrSnapshot {
  table: ITableVo;

  recordData: {
    records: IRecord[];
    total: number;
  };

  views: IViewVo[];

  fields: IFieldVo[];
}
