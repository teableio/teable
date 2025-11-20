import type { ITableQuery } from '@teable/openapi';
import { AGGREGATE_COUNT_KEY, DataSource, DEFAULT_SERIES_ARRAY } from '@teable/openapi';
import type { ISeriesConfig } from '../types';
import { getGroupKeyName } from '../utils';
import { BaseChart, type IChartOptions } from './BaseChart';

export class PieChart extends BaseChart {
  protected radiusConfig: string | string[] = '80%';

  generateOptions(): IChartOptions {
    const { legendVisible } = this.storage.appearance;

    return {
      legend: {
        show: legendVisible,
        top: 0,
        type: 'scroll',
        orient: 'horizontal',
        pageButtonPosition: 'end',
      },
      tooltip: {
        trigger: 'item',
        confine: true,
        textStyle: {
          fontSize: this.getTooltipFontSize(),
        },
      },
      series: this.buildSeries(),
    } as IChartOptions;
  }

  protected buildSeries(): ISeriesConfig[] {
    const data = this.buildPieData();
    const { labelVisible } = this.storage.appearance;
    return [
      {
        name: this.getKey(),
        type: 'pie',
        // distance to legend
        // center: ['50%', '60%'],
        radius: this.radiusConfig,
        data,
        universalTransition: true,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
        label: {
          show: labelVisible ?? true,
        },
      },
    ];
  }

  protected buildPieData(): { value: number; name: string }[] {
    const { rawData } = this.chartData;
    const { dataSource, query } = this.storage;

    const key = this.getKey();

    if (dataSource === DataSource.Table) {
      return rawData.map((item) => {
        const xAxis = (query as ITableQuery).xAxis;
        const value = item[key];
        const finalName =
          getGroupKeyName(this.fields.find((field) => field.id === xAxis)!, item[xAxis]) || 'null';
        return {
          value,
          name: finalName,
        } as { value: number; name: string };
      });
    }

    const { xAxis } = this.storage.config;
    return rawData.map((item) => {
      const value = item[key];
      const name = item[xAxis];
      return {
        value,
        name,
      } as { value: number; name: string };
    });
  }

  private getKey(): string {
    const { dataSource } = this.storage;
    if (dataSource === DataSource.Table) {
      const { seriesArray } = this.storage.query as ITableQuery;
      const fieldMap = this.getFieldMap();
      return seriesArray === DEFAULT_SERIES_ARRAY
        ? AGGREGATE_COUNT_KEY
        : `${fieldMap?.[(seriesArray as { fieldId: string }[])?.at(0)?.fieldId ?? '']}_${(seriesArray as { rollup: string }[])?.at(0)?.rollup ?? ''}`;
    }

    const { yAxis } = this.storage.config;
    return yAxis.at(0) as string;
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
}

export class DonutChart extends PieChart {
  protected radiusConfig = ['40%', '80%'];

  protected buildSeries(): ISeriesConfig[] {
    const series = super.buildSeries();
    return series.map((s) => ({
      ...s,
      avoidLabelOverlap: false,
    })) as ISeriesConfig[];
  }
}
