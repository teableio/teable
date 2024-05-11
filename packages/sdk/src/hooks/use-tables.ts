import { orderBy } from 'lodash';
import { useContext, useMemo } from 'react';
import { TableContext } from '../context/table';

export function useTables() {
  const tableContext = useContext(TableContext);
  return useMemo(() => orderBy(tableContext?.tables, ['order']), [tableContext?.tables]);
}
