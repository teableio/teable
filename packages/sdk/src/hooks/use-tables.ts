import { orderBy } from 'lodash';
import { useContext, useMemo } from 'react';
import { TableContext } from '../context/table';

export function useTables() {
  const { tables } = useContext(TableContext);
  return useMemo(() => orderBy(tables, ['order']), [tables]);
}
