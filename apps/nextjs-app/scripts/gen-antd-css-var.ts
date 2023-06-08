import fs from 'fs';
import { theme } from 'antd';
import type { MapToken } from 'antd/es/theme/interface';
import { colors } from '../src/themes/colors';
import { ThemeName } from '../src/themes/type';
import { getColorsCssVariablesText } from '../src/themes/utils';

const outputPath = './src/themes/antd.variables.css';

const darkColors = colors.dark;
const darkTheme = theme.darkAlgorithm({
  ...theme.defaultConfig.token,
  colorPrimary: darkColors.primary,
  colorSuccess: darkColors.success,
  colorInfo: darkColors.info,
  colorError: darkColors.error,
  colorWarning: darkColors.warning,
  colorBgBase: darkColors.base100,
  colorTextBase: darkColors.baseContent,
});

const lightColors = colors.light;
const lightTheme = theme.compactAlgorithm({
  ...theme.defaultConfig.token,
  colorPrimary: lightColors.primary,
  colorSuccess: lightColors.success,
  colorInfo: lightColors.info,
  colorError: lightColors.error,
  colorWarning: lightColors.warning,
  colorBgBase: lightColors.base100,
  colorTextBase: lightColors.baseContent,
});

const filteredColors = (theme: MapToken) => {
  return Object.fromEntries(Object.entries(theme).filter(([key]) => key.startsWith('color')));
};

const cssVariablesText = getColorsCssVariablesText({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [ThemeName.Light]: filteredColors(lightTheme) as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [ThemeName.Dark]: filteredColors(darkTheme) as any,
});

fs.writeFileSync(outputPath, cssVariablesText);
