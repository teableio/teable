import type { IFieldVo } from '../field';
import type { IRecord } from '../record';
import type { IViewVo } from '../view';

export interface ICreateTableMetaRo {
  name: string;
  description?: string;
  icon?: string;
}

export interface ITableVo extends ICreateTableMetaRo {
  id: string;
}

export interface ITableSnapshot {
  table: ITableVo;
  order: number;
}

export interface IFullSsrSnapshot {
  rows: {
    records: IRecord[];
    total: number;
  };

  tables: ITableVo[];

  views: IViewVo[];

  fields: IFieldVo[];
}
