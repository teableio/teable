import type { EChartsOption, LineSeriesOption } from 'echarts';
import { Base } from './base';
import { ChartType } from './type';

export class Line extends Base {
  type = ChartType.Line;

  getOptions(): EChartsOption {
    const seriesArr = this.getSeries();
    const xAxisData: string[] = [];
    const series: LineSeriesOption[] = [];
    let first = true;
    seriesArr.forEach((seriesDataMap) => {
      const seriesData: number[] = [];
      Object.keys(seriesDataMap).forEach((key) => {
        first && xAxisData.push(key);
        seriesData.push(seriesDataMap[key]);
      });
      series.push({
        type: ChartType.Line,
        data: seriesData,
      });
      first = false;
    });
    return {
      tooltip: {
        trigger: 'item',
      },
      xAxis: {
        type: 'category',
        data: xAxisData,
      },
      yAxis: {
        type: 'value',
      },
      series,
    };
  }
}
