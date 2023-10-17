import { useContext } from 'react';
import { AppContext } from '../context';

export function useDriver() {
  const { driver } = useContext(AppContext);
  return driver;
}
