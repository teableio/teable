import { kebabCase } from 'lodash';
import type { IColor } from './colors';
import type { ThemeName } from './type';

export const getColorsCssVariablesText = (themeData: { [key in ThemeName]: IColor }) => {
  return Object.entries(themeData)
    .map(([themeName, properties]) => {
      const cssVariables = Object.entries(properties)
        .map(([key, value]) => `  --${kebabCase(key)}: ${value};`)
        .join('\n');
      return `:root[data-theme="${themeName}"] {\n${cssVariables} \n}\n`;
    })
    .join('\n');
};
