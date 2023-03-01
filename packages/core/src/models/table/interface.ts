import type { IFieldVo } from '../field';
import type { IRecord } from '../record';
import type { IViewVo } from '../view';

export interface ITable {
  id: string;
  name: string;
  description: string;
}

export interface ITableSnapshot {
  recordData: {
    records: IRecord[];
    total: number;
  };

  views: IViewVo[];

  fields: IFieldVo[];
}
