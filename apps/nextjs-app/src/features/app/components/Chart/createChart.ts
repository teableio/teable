import { Bar } from './bar';
import { Line } from './line';
import { Pie } from './pie';
import type { IChartData, IChartOptions } from './type';
import { ChartType } from './type';

export const createChart = (
  type: ChartType,
  context: { options: IChartOptions; data: IChartData }
) => {
  const { options, data } = context;
  switch (type) {
    case ChartType.Bar:
      return new Bar(options, data);
    case ChartType.Pie:
      return new Pie(options, data);
    case ChartType.Line:
      return new Line(options, data);
    default:
      throw new Error('Unknown chart type: ' + type);
  }
};
