import type { IColor } from './colors';

export enum ThemeName {
  Light = 'light',
  Dark = 'dark',
}

export interface ITheme {
  color: IColor;
}
