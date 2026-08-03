export enum ChartType {
  Bar = 'bar',
  Pie = 'pie',
  Line = 'line',
}

export interface ISeries {
  fieldName: string;
}

export enum Statistic {
  Count = 'Count',
  Sum = 'Sum',
}

export interface IChartOptions {
  xAxis: {
    fieldName: string;
  };
  series: ISeries[];
  statistic: Statistic;
}

export type IChartData = { [fieldName: string]: unknown }[];
