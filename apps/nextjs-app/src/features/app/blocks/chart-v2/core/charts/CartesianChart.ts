import { ChartType } from '@teable/openapi';
import type { ISeriesConfig } from '../types';
import { BaseChart, type IChartOptions } from './BaseChart';

const DEFAULT_GRID_PADDING = '20px';
const DEFAULT_GRID_PADDING_TOP = '40px';

export class CartesianChart extends BaseChart {
  generateOptions(): IChartOptions {
    const { legendData, xData, series } = this.chartData;
    const { appearance } = this.storage;
    const { legendVisible } = appearance;
    const completeSeries = this.buildSeries(series);

    const { h } = this.layout || {};

    return {
      legend: {
        show: legendVisible ?? true,
        top: 0,
        type: 'scroll',
        data: legendData,
        orient: 'horizontal',
        pageButtonPosition: 'end',
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        textStyle: {
          fontSize: this.getTooltipFontSize(),
        },
      },
      xAxis: {
        type: 'category' as const,
        data: xData,
        axisLine: {
          show: true,
          lineStyle: {
            color: '#999',
            width: 1,
          },
        },
        axisTick: {
          show: false,
          length: 5,
        },
        axisLabel: {
          interval: 0,
          rotate: 30,
          overflow: 'truncate',
          ellipsis: '...',
          hideOverlap: false,
          formatter: (value: string) => {
            const maxLength = (h || 0) <= 3 ? 2 : 8;
            if (value.length > maxLength) {
              return value.substring(0, maxLength) + '...';
            }
            return value;
          },
        },
        splitLine: {
          show: false,
        },
      },
      yAxis: {
        type: 'value',
        axisLine: {
          show: true,
          lineStyle: {
            color: '#999',
            width: 1,
          },
        },
        axisTick: {
          show: false,
          length: 5,
        },
        splitLine: {
          show: false,
          lineStyle: {
            color: '#E5E7EB',
            width: 1,
            type: 'dashed',
          },
        },
      },
      series: completeSeries,
      grid: {
        left: DEFAULT_GRID_PADDING,
        right: DEFAULT_GRID_PADDING,
        top: DEFAULT_GRID_PADDING_TOP,
        bottom: DEFAULT_GRID_PADDING,
        containLabel: true,
      },
    };
  }

  protected buildSeries(series: ISeriesConfig[]): ISeriesConfig[] {
    const { chartType } = this.storage;
    const { appearance } = this.storage;
    const { labelVisible } = appearance;

    return series.map((item: ISeriesConfig) => {
      const { name, data } = item;
      return {
        name,
        data,
        type: this.echartsType as ChartType,
        universalTransition: true,
        areaStyle: chartType === ChartType.Area ? { opacity: 0.6 } : undefined,
        label: {
          show: labelVisible,
          position: 'top',
          distance: 5,
          align: 'center',
          verticalAlign: 'middle',
        },
      } as ISeriesConfig;
    });
  }
}
