import type { EChartsOption } from 'echarts';
import { Base } from './base';
import { ChartType } from './type';

export class Pie extends Base {
  type = ChartType.Pie;

  getOptions(): EChartsOption {
    const seriesDataMap = this.getSeries()[0] || {};
    const seriesData = Object.keys(seriesDataMap).map((key) => ({
      name: key,
      value: seriesDataMap[key],
    }));

    return {
      tooltip: {
        trigger: 'item',
      },
      legend: {
        left: 'center',
      },
      series: {
        type: ChartType.Pie,
        radius: '60%',
        data: seriesData,
      },
    };
  }
}
