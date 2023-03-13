import { AppContext } from '../context';
import { useContext } from 'react';

export function useSpace() {
  const { space } = useContext(AppContext);
  return space!;
}
