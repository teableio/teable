import { useContext } from 'react';
import { TableContext } from '../context/table';

export function useTables() {
  const { tables } = useContext(TableContext);
  return tables;
}
