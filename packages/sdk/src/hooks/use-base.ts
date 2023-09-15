import { useContext } from 'react';
import { BaseContext } from '../context/base/BaseContext';

export function useBase() {
  const { base } = useContext(BaseContext);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return base!;
}
