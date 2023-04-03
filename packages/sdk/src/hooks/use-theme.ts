import { useContext } from 'react';
import { AppContext } from '../context';

export function useTheme() {
  const { theme, setTheme, isAutoTheme } = useContext(AppContext);
  return { theme, setTheme, isAutoTheme };
}
