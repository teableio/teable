import { useContext } from 'react';
import { TableContext } from '../context';

export function useTable() {
  const { tables, tableId } = useContext(TableContext);
  return tables.find((table) => table.id === tableId);
}
