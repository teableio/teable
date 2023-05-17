import { ThemeKey, useTheme } from '@teable-group/sdk';

const lightTheme = {
  bgHeader: '#F7F7F8',
};

const darkTheme = {
  accentColor: '#8c96ff',
  accentLight: 'rgba(202, 206, 255, 0.253)',
  textDark: '#ffffff',
  textMedium: '#b8b8b8',
  textLight: '#a0a0a0',
  textBubble: '#ffffff',
  bgIconHeader: '#b8b8b8',
  fgIconHeader: '#000000',
  textHeader: '#a1a1a1',
  textHeaderSelected: '#000000',
  bgCell: '#2a303c',
  bgCellMedium: '#202027',
  bgHeader: '#2a303c',
  bgHeaderHasFocus: '#474747',
  bgHeaderHovered: '#404040',
  bgBubble: '#2a303c',
  bgBubbleSelected: '#000000',
  bgSearchResult: '#423c24',
  borderColor: 'rgba(225,225,225,0.2)',
  drilldownBorder: 'rgba(225,225,225,0.4)',
  linkColor: '#4F5DFF',
  headerFontStyle: 'bold 14px',
  baseFontStyle: '13px',
  fontFamily:
    'Inter, Roboto, -apple-system, BlinkMacSystemFont, avenir next, avenir, segoe ui, helvetica neue, helvetica, Ubuntu, noto, arial, sans-serif',
};

export function useGridTheme() {
  const { theme } = useTheme();
  return theme === ThemeKey.Dark ? darkTheme : lightTheme;
}
