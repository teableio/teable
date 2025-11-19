import type { IFieldVo } from '@teable/core';
import type { IChartStorage, IDashboardLayout } from '@teable/openapi';
import type { IChartData } from '../adapters/BaseAdapter';
import type { ISeriesConfig } from '../types';

export interface IChartOptions {
  backgroundColor?: string;
  legend: {
    show: boolean;
    top: number;
    data?: string[];
    orient?: 'horizontal' | 'vertical';
    type?: 'plain' | 'scroll';
    pageButtonPosition?: 'start' | 'end';
  };
  tooltip?: {
    trigger?: 'item' | 'axis' | 'none';
    confine?: boolean;
    textStyle?: {
      fontSize?: number;
      color?: string;
      fontWeight?: string | number;
    };
    formatter?: string | ((params: unknown) => string);
  };
  xAxis?: {
    type: 'category';
    data: string[];
    axisLine?: {
      show: boolean;
      lineStyle?: {
        color?: string;
        width?: number;
      };
    };
    axisTick?: {
      show: boolean;
      length?: number;
    };
    axisLabel?: {
      interval?: number | 'auto';
      rotate?: number;
      overflow?: 'truncate' | 'break' | 'breakAll';
      ellipsis?: string;
      hideOverlap?: boolean;
      formatter?: (value: string) => string;
    };
    splitLine?: {
      show: boolean;
      lineStyle?: {
        color?: string;
        width?: number;
        type?: string;
      };
    };
  };
  yAxis?: {
    type: 'value';
    axisLine?: {
      show: boolean;
      lineStyle?: {
        color?: string;
        width?: number;
      };
    };
    axisTick?: {
      show: boolean;
      length?: number;
    };
    splitLine?: {
      show: boolean;
      lineStyle?: {
        color?: string;
        width?: number;
        type?: string;
      };
    };
  };
  grid?: {
    left?: string | number;
    right?: string | number;
    top?: string | number;
    bottom?: string | number;
    containLabel?: boolean;
  };
  series: ISeriesConfig[];
}

export abstract class BaseChart {
  protected storage: IChartStorage;
  protected chartData: IChartData;
  protected echartsType: string;
  protected fields: IFieldVo[];
  protected layout?: IDashboardLayout[number];

  constructor(
    storage: IChartStorage,
    chartData: IChartData,
    echartsType: string,
    fields: IFieldVo[],
    layout?: IDashboardLayout[number]
  ) {
    this.storage = storage;
    this.chartData = chartData;
    this.echartsType = echartsType;
    this.fields = fields;
    this.layout = layout;
  }

  abstract generateOptions(): IChartOptions;

  protected abstract buildSeries(series: ISeriesConfig[]): ISeriesConfig[];

  protected getBaseOptions(): IChartOptions {
    return {} as IChartOptions;
  }

  protected getTooltipFontSize(): number {
    const defaultFontSize = 14;

    if (!this.layout) {
      return defaultFontSize;
    }

    const estimatedWidth = this.layout.w * 100;

    if (estimatedWidth < 300) {
      return 10;
    } else if (estimatedWidth < 500) {
      return 12;
    } else if (estimatedWidth < 700) {
      return 14;
    } else {
      return 16;
    }
  }
}
