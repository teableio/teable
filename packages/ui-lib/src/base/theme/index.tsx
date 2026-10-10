import { ThemeProvider, useTheme as useNextTheme } from 'next-themes';

export { ThemeProvider };

// next-themes keeps `theme` and `resolvedTheme` on the stored preference while
// `forcedTheme` is set (pacocoursey/next-themes#252). Canvas and chart code picks
// its colors from resolvedTheme, so a forced page has to report the forced value.
export const useTheme = () => {
  const context = useNextTheme();
  const { forcedTheme } = context;
  if (!forcedTheme) {
    return context;
  }
  return { ...context, theme: forcedTheme, resolvedTheme: forcedTheme };
};
