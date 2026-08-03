import type { EChartsOption } from 'echarts';
import { toNumber } from 'lodash';
import type { ChartType, IChartData, IChartOptions, ISeries } from './type';
import { Statistic } from './type';

export abstract class Base {
  abstract type: ChartType;
  options: IChartOptions;
  data: IChartData;
  constructor(options: IChartOptions, data: IChartData) {
    this.options = options;
    this.data = data;
  }
  abstract getOptions(): EChartsOption;

  private getSeriesMap(series: ISeries) {
    const { statistic, xAxis } = this.options;
    const xAxisFieldName = xAxis.fieldName;
    const seriesFieldName = series.fieldName;
    switch (statistic) {
      case Statistic.Count: {
        const valueMap: { [key: string]: number } = {};
        this.data.forEach((item) => {
          const fieldValue = item[xAxisFieldName || seriesFieldName]?.toString();
          if (!fieldValue) {
            return;
          }
          const count = valueMap[fieldValue] || 0;
          valueMap[fieldValue] = count + 1;
        });
        return valueMap;
      }
      case Statistic.Sum: {
        const valueMap: { [key: string]: number } = {};
        this.data.forEach((item) => {
          const fieldValue = item[xAxisFieldName || seriesFieldName]?.toString();
          if (!fieldValue) {
            return;
          }
          const value = valueMap[fieldValue] || 0;
          valueMap[fieldValue] = toNumber(item[seriesFieldName]) + value;
        });
        return valueMap;
      }
      default:
        return {};
    }
  }

  getSeries() {
    return this.options.series.map((item) => this.getSeriesMap(item));
  }
}
