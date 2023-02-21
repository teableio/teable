import { useContext } from 'react';
import { TableContext } from '../context';

export function useTableId() {
  const { tableId } = useContext(TableContext);
  return tableId;
}
