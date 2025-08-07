import { orderBy } from 'lodash';
import { useContext, useMemo } from 'react';
import { useBuildBaseAgentStore } from '../components/grid-enhancements/store/useBuildBaseAgentStore';
import { TableContext } from '../context/table';

export function useTables() {
  const tableContext = useContext(TableContext);
  const { displayTables, building } = useBuildBaseAgentStore();
  return useMemo(() => {
    if (building) {
      return orderBy(tableContext?.tables, ['order']).filter((table) =>
        displayTables.includes(table.id)
      );
    }
    return orderBy(tableContext?.tables, ['order']);
  }, [tableContext?.tables, displayTables, building]);
}
