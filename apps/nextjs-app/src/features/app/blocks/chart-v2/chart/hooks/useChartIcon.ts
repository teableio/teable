import { AreaChart, DonutChart, ColumnChart, LineChart, PieChart } from '@teable/icons';
import { ChartType } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';

export const useChartIcon = () => {
  const { t } = useTranslation('chart');
  const iconGetter = useCallback((type: ChartType) => {
    switch (type) {
      case ChartType.Bar:
        return ColumnChart;
      case ChartType.Line:
        return LineChart;
      case ChartType.Area:
        return AreaChart;
      case ChartType.Pie:
        return PieChart;
      case ChartType.DonutChart:
        return DonutChart;
      default:
        throw new Error(`Unknown chart type: ${type}`);
    }
  }, []);
  const labelGetter = useCallback(
    (type: ChartType) => {
      switch (type) {
        case ChartType.Bar:
          return t('chartV2.form.chartType.bar');
        case ChartType.Line:
          return t('chartV2.form.chartType.line');
        case ChartType.Area:
          return t('chartV2.form.chartType.area');
        case ChartType.Pie:
          return t('chartV2.form.chartType.pie');
        case ChartType.DonutChart:
          return t('chartV2.form.chartType.donutChart');
        default:
          throw new Error(`Unknown chart type: ${type}`);
      }
    },
    [t]
  );
  return { iconGetter, labelGetter };
};
