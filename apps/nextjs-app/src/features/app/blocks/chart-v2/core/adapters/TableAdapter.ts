import type { IFieldVo } from '@teable/core';
import type { IChartStorage, ITableQuery } from '@teable/openapi';
import { AGGREGATE_COUNT_KEY, DEFAULT_SERIES_ARRAY } from '@teable/openapi';
import { groupBy } from 'lodash';
import type { ISeriesConfig } from '../types';
import { getGroupUniqueKey, getGroupKeyName } from '../utils';
import { BaseAdapter, type IChartData } from './BaseAdapter';

export const MAX_X_DATA_LENGTH = 50;
export class TableAdapter extends BaseAdapter<ITableQuery> {
  private fields: IFieldVo[];

  constructor(
    storage: IChartStorage<ITableQuery>,
    result: Record<string, unknown>[],
    fields: IFieldVo[] = []
  ) {
    super(storage, result);
    this.fields = fields;
  }

  private getFieldMap(): Record<string, string> {
    return this.fields.reduce(
      (acc, field) => {
        acc[field.id] = field.dbFieldName;
        acc[field.dbFieldName] = field.id;
        return acc;
      },
      {} as Record<string, string>
    );
  }

  getData(): IChartData {
    const xData = this.getXData();
    const legendData = this.buildLegendData();
    const series = this.getSeries(xData, legendData);
    const finalXData = this.getRealXData(xData);

    return {
      xData: finalXData,
      legendData,
      rawData: this.result,
      series,
    };
  }

  getRealXData(xData: string[]) {
    const { query } = this.storage;
    const { xAxis } = query;
    const grouped = groupBy(this.result, (item) => getGroupUniqueKey(item[xAxis]));
    const field = this.fields.find((field) => field.id === xAxis)!;
    return xData.map((x) => {
      const groupedItem = grouped[x]?.[0]?.[xAxis];

      if (groupedItem === null) {
        return 'null';
      }

      return getGroupKeyName(field, groupedItem);
    });
  }

  private getXData(): string[] {
    const { query } = this.storage;
    const { xAxis } = query;

    const grouped = groupBy(this.result, (item) => getGroupUniqueKey(item[xAxis]));

    return Object.keys(grouped).slice(0, MAX_X_DATA_LENGTH);
  }

  private buildLegendData(): string[] {
    const { query } = this.storage;
    const { seriesArray } = query;
    const countAll = seriesArray === DEFAULT_SERIES_ARRAY;

    // no need legend data
    if (countAll) {
      return this.getLegendDataByCountAll();
    }

    return this.getLegendDataByFieldValue();
  }

  private getLegendDataByCountAll(): string[] {
    const { groupBy: groupByFiledId } = this.storage.query;

    if (groupByFiledId) {
      return Object.keys(groupBy(this.result, (item) => getGroupUniqueKey(item[groupByFiledId])));
    }

    return ['count'];
  }

  private getLegendDataByFieldValue(): string[] {
    const { seriesArray, groupBy: groupByFiledId } = this.storage.query;
    const fieldMap = this.getFieldMap();

    if (groupByFiledId) {
      return Object.keys(groupBy(this.result, (item) => getGroupUniqueKey(item[groupByFiledId])));
    }

    return Array.isArray(seriesArray) ? seriesArray.map(({ fieldId }) => fieldMap?.[fieldId]) : [];
  }

  getSeries(xData: string[], legendData: string[]): ISeriesConfig[] {
    const { query } = this.storage;
    const { seriesArray } = query;
    const countAll = seriesArray === DEFAULT_SERIES_ARRAY;

    if (countAll) {
      return this.getSeriesByCountAll(xData, legendData);
    }

    return this.getSeriesByFieldValue(xData, legendData);
  }

  private getSeriesByCountAll(xData: string[], legendData: string[]): ISeriesConfig[] {
    const { groupBy: groupByFiledId, xAxis } = this.storage.query;

    if (!groupByFiledId) {
      const countArray = this.result.map(
        (item) => this.getValueByKey(item, AGGREGATE_COUNT_KEY) as number
      );
      return legendData.map((name) => ({
        name,
        data: countArray,
      }));
    }

    const groupByData = groupBy(this.result, (item) => getGroupUniqueKey(item[groupByFiledId]));

    return legendData.map((name) => {
      const currentGroup = groupByData[name];
      return {
        name,
        data: xData.map((xName) => {
          const item = currentGroup?.find((item) => getGroupUniqueKey(item[xAxis]) === xName);
          return item?.[AGGREGATE_COUNT_KEY] || 0;
        }),
      };
    }) as ISeriesConfig[];
  }

  private getSeriesByFieldValue(xData: string[], legendData: string[]): ISeriesConfig[] {
    const { seriesArray, xAxis, groupBy: groupByFiledId } = this.storage.query;
    if (Array.isArray(seriesArray) && seriesArray.length < 2) {
      if (!groupByFiledId) {
        const name = legendData[0];
        const rollup = seriesArray[0]?.rollup;
        const key = `${name}_${rollup}`;
        return [
          {
            name: legendData[0],
            data: this.result.map((item) => item?.[key] as number),
          },
        ] as ISeriesConfig[];
      }

      const fieldMap = this.getFieldMap();
      const groupByData = groupBy(this.result, (item) => getGroupUniqueKey(item[xAxis]));

      return legendData.map((name) => {
        const keyName = fieldMap?.[seriesArray[0]?.fieldId];
        const key = `${keyName}_${seriesArray[0]?.rollup}`;
        return {
          name,
          data: xData.map((xName) => {
            const item = groupByData?.[xName]?.find(
              (item) => getGroupUniqueKey(item[groupByFiledId]) === name
            );
            return item?.[key] || 0;
          }),
        };
      }) as ISeriesConfig[];
    }

    return legendData.map((name, index) => {
      const rollup = Array.isArray(seriesArray) ? seriesArray[index]?.rollup : undefined;
      const key = `${name}_${rollup}`;

      return {
        name,
        data: xData.map((xName) => {
          const item = this.result?.find((item) => getGroupUniqueKey(item[xAxis]) === xName);
          return item?.[key] || 0;
        }),
      };
    }) as ISeriesConfig[];
  }
}
