import { useContext } from 'react';
import { RowCountContext } from '../context';

export function useRowCount() {
  return useContext(RowCountContext);
}
