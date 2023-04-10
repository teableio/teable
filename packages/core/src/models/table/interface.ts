import type { IFieldRo, IFieldVo } from '../field';
import type { ICreateRecordsDto, IRecord } from '../record';
import type { IViewRo, IViewVo } from '../view';

export interface ICreateTableRo {
  name: string;
  description?: string;
  icon?: string;
  fields?: IFieldRo[];
  views?: IViewRo[];
  rows?: ICreateRecordsDto;
}

export interface ITableVo extends ICreateTableRo {
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
