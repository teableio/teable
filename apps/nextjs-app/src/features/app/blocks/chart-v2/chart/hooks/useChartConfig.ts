import { useTheme } from '@teable/next-themes';
import type { IChartStorage } from '@teable/openapi';
import type { ThemeName } from '@/themes/type';
import { useStorage } from '../../hooks';
import { getChartConfigByType, getEchartsType, getThemeByName } from '../utils';
export const useChartConfig = () => {
  const { storage } = useStorage();
  const {
    chartType,
    appearance: { theme },
  } = storage as IChartStorage;
  const { resolvedTheme } = useTheme();
  const themeColors = getThemeByName(theme, resolvedTheme as ThemeName);
  return {
    config: getChartConfigByType(chartType, themeColors),
    echartsType: getEchartsType(chartType),
  };
};
