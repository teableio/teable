import { LocalStorageKeys } from '../../config/local-storage-keys';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalstorageState } from 'rooks';
import { ThemeKey } from './AppContext';

interface IUseThemeResult {
  theme: ThemeKey;
  isAutoTheme: boolean;
  setTheme: (theme: ThemeKey | null) => void;
}

const darkModeMediaQuery = '(prefers-color-scheme: dark)';

/**
 * Theme provider
 * if user set theme manually, it will keep in localstorage
 * if user didn't set theme manually, it will use system theme
 * user can reset it by pass null in setTheme function
 */
export function useTheme(): IUseThemeResult {
  const [autoTheme, setAutoTheme] = useState(
    window.matchMedia && window.matchMedia(darkModeMediaQuery).matches
      ? ThemeKey.Dark
      : ThemeKey.Light
  );
  const [theme, setTheme] = useLocalstorageState<ThemeKey | null>(LocalStorageKeys.Theme);

  const setThemeState = useCallback((themeKey: ThemeKey | null) => {
    setTheme(themeKey);
  }, []);

  useEffect(() => {
    function change(event: MediaQueryListEvent) {
      const darkMode = event.matches;
      setAutoTheme(darkMode ? ThemeKey.Dark : ThemeKey.Light);
    }
    window.matchMedia(darkModeMediaQuery).addEventListener('change', change);
    return () => {
      window.matchMedia(darkModeMediaQuery).removeEventListener('change', change);
    };
  }, []);

  return useMemo(
    () => ({
      theme: theme ? theme : autoTheme,
      isAutoTheme: !Boolean(theme),
      setTheme: setThemeState,
    }),
    [theme, autoTheme, setThemeState]
  );
}
