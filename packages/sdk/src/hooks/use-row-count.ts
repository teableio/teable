import { useContext } from 'react';
import { RecordContext } from '../context';

export function useRowCount() {
  const { rowCount } = useContext(RecordContext);
  return rowCount;
}
