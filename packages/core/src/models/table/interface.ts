import type { IFieldRo, IFieldVo } from '../field';
import type { ICreateRecordsRo, IRecord } from '../record';
import type { IViewRo, IViewVo } from '../view';

export interface ICreateTableRo {
  name: string;
  description?: string;
  icon?: string;
  fields?: IFieldRo[];
  views?: IViewRo[];
  data?: ICreateRecordsRo;
}

export interface ITableApiVo {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  fieldIds: string[];
  viewIds: string[];
  recordIds: string[];
}

export interface ITableVo {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  order: number;
}

export interface ITableSnapshot {
  table: ITableVo;
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
