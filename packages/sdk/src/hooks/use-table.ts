import { useContext } from 'react';
import { AnchorContext, TableContext } from '../context';

export function useTable() {
  const { tableId } = useContext(AnchorContext);
  const { tables } = useContext(TableContext);

  return tables.find((table) => table.id === tableId);
}
