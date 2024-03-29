import { useEffect, useMemo, useState } from 'react';
import { useLocalStorage } from 'react-use';
import { LocalStorageKeys } from '../../config/local-storage-keys';
import { ThemeKey } from './AppContext';

interface IUseThemeResult {
  theme: ThemeKey;
  isAutoTheme: boolean;
  setTheme: (theme: ThemeKey | null) => void;
}

const darkModeMediaQuery = '(prefers-color-scheme: dark)';

function updateTheme(theme: ThemeKey | null) {
  theme === ThemeKey.Dark
    ? document.documentElement.classList.add(ThemeKey.Dark)
    : document.documentElement.classList.remove(ThemeKey.Dark);
}

export function getTheme() {
  return typeof window === 'object' &&
    window.matchMedia &&
    window.matchMedia(darkModeMediaQuery).matches
    ? ThemeKey.Dark
    : ThemeKey.Light;
}

/**
 * Theme provider
 * if user set theme manually, it will keep in localstorage
 * if user didn't set theme manually, it will use system theme
 * user can reset it by pass null in setTheme function
 */
export function useTheme(): IUseThemeResult {
  const [autoTheme, setAutoTheme] = useState(ThemeKey.Light);
  const [theme, setTheme] = useLocalStorage<ThemeKey | null>(LocalStorageKeys.Theme);

  useEffect(() => {
    updateTheme(theme || autoTheme);
  }, [theme, autoTheme]);

  // run in browser environment
  useEffect(() => {
    setAutoTheme(getTheme());
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
  }, [autoTheme, theme]);

  return useMemo(
    () => ({
      theme: theme || autoTheme,
      isAutoTheme: !theme,
      setTheme,
    }),
    [theme, autoTheme, setTheme]
  );
}
