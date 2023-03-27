import { useContext } from 'react';
import { AppContext } from '../context';

export function useSpace() {
  const { space } = useContext(AppContext);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return space!;
}
