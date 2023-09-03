import { useContext } from 'react';
import { RowCountContext } from '../context/aggregation/RowCountContext';

export function useRowCount() {
  return useContext(RowCountContext);
}
