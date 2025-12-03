import { ChartType } from '@teable/openapi';
import { ThemeName } from '@/themes/type';
import { BASE_CHART_CONFIG, THEMES, DARK_THEMES } from './constant';

export const getChartConfigByType = (type: ChartType, theme: string[]) => {
  switch (type) {
    case ChartType.Line:
    case ChartType.Bar:
      return {
        ...BASE_CHART_CONFIG,
        color: theme,
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'shadow',
          },
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          containLabel: true,
        },
        xAxis: {
          type: 'category' as const,
          data: [],
        },
        yAxis: {
          type: 'value' as const,
        },
        series: [],
      };
    case ChartType.Area: {
      return {
        ...BASE_CHART_CONFIG,
        color: theme,
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'shadow',
          },
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          containLabel: true,
        },
        xAxis: {
          type: 'category' as const,
          data: [],
          boundaryGap: false,
        },
        yAxis: {
          type: 'value' as const,
        },
        series: [],
      };
    }
    case ChartType.DonutChart:
    case ChartType.Pie:
      return {
        ...BASE_CHART_CONFIG,
        color: theme,
        tooltip: {
          trigger: 'item',
        },
        legend: {
          orient: 'vertical',
          left: 'left',
        },
        series: [],
      };
    default:
      return BASE_CHART_CONFIG;
  }
};

export const getEchartsType = (type: ChartType) => {
  switch (type) {
    case ChartType.Line:
      return 'line';
    case ChartType.Bar:
      return 'bar';
    case ChartType.Area:
      return 'line';
    case ChartType.Pie:
      return 'pie';
    case ChartType.DonutChart:
      return 'pie';
    default:
      return type;
  }
};

export const getThemeByName = (name: string = 'blue', theme: ThemeName = ThemeName.Light) => {
  const isDark = theme === ThemeName.Dark;
  const themes = isDark ? DARK_THEMES : THEMES;
  return themes[name as keyof typeof themes] || themes.blue;
};

export const getEchartsTheme = (theme: ThemeName = ThemeName.Light) => {
  return Object.keys(THEMES).map((key) => {
    return {
      name: key,
      colors: getThemeByName(key, theme),
    };
  });
};
