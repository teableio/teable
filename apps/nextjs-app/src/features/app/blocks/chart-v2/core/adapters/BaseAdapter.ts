import type { IChartStorage, ITableQuery, ISqlQuery } from '@teable/openapi';
import type { ISeriesConfig } from '../types';

export interface IChartData {
  xData: string[];
  legendData: string[];
  rawData: Record<string, unknown>[];
  series: ISeriesConfig[];
}

export abstract class BaseAdapter<T extends ITableQuery | ISqlQuery> {
  protected storage: IChartStorage<T>;
  protected result: Record<string, unknown>[];

  constructor(storage: IChartStorage<T>, result: Record<string, unknown>[]) {
    this.storage = storage;
    this.result = result;
  }

  abstract getData(): IChartData;

  protected getValueByKey(item: Record<string, unknown>, key: string): unknown {
    return item?.[key];
  }

  abstract getSeries(xData: string[], legendData: string[]): ISeriesConfig[];
}
