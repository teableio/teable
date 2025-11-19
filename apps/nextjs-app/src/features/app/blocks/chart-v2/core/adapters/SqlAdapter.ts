import type { ISqlQuery } from '@teable/openapi';
import { groupBy } from 'lodash';
import type { ISeriesConfig } from '../types';
import { BaseAdapter, type IChartData } from './BaseAdapter';

export class SqlAdapter extends BaseAdapter<ISqlQuery> {
  getData(): IChartData {
    const { config } = this.storage;
    const { yAxis = [] } = config || {};

    const xData = this.getXData();
    const legendData = yAxis;

    const series = this.getSeries(xData, legendData);

    return {
      xData,
      legendData,
      rawData: this.result,
      series,
    };
  }

  private getXData(): string[] {
    const { xAxis } = this.storage.config || {};
    if (xAxis) {
      return Object.keys(groupBy(this.result, xAxis));
    }
    return [];
  }

  getSeries(xData: string[], legendData: string[]): ISeriesConfig[] {
    const { xAxis } = this.storage.config;
    return legendData.map((name) => {
      const groupByData = groupBy(this.result, xAxis);
      return {
        name,
        data: xData.map((xName) => {
          return groupByData?.[xName]?.find((item) => item?.[xAxis] == xName)?.[name] ?? 0;
        }),
      };
    }) as ISeriesConfig[];
  }
}
