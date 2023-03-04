import { AppContext } from '../context';
import { useContext } from 'react';

export function useTheme() {
  const { theme, setTheme, isAutoTheme } = useContext(AppContext);
  return { theme, setTheme, isAutoTheme };
}
