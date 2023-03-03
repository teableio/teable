import { useCallback, useState } from 'react';

const lightTheme = {};

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

export function useTheme(): [Record<string, string>, () => void] {
  const darkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  const [theme, setTheme] = useState<Record<string, string>>(darkMode ? darkTheme : lightTheme);

  const toggle = useCallback(() => {
    if (theme === darkTheme) {
      setTheme(lightTheme);
    } else {
      setTheme(darkTheme);
    }
  }, []);

  return [theme, toggle];
}
