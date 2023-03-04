import { TableContext } from '../context/table';
import { useContext } from 'react';

export function useTables() {
  const { tables } = useContext(TableContext);
  return tables;
}
