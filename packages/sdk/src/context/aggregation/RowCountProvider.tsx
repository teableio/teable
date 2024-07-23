import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ITableActionKey, IViewActionKey } from '@teable/core';
import { getRowCount } from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useIsHydrated, useSearch, useTableListener, useViewListener } from '../../hooks';
import { AnchorContext } from '../anchor';
import { RowCountContext } from './RowCountContext';

interface RowCountProviderProps {
  children: ReactNode;
}

export const RowCountProvider: FC<RowCountProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const queryClient = useQueryClient();
  const { searchQuery } = useSearch();

  const rowCountQuery = useMemo(() => ({ viewId, search: searchQuery }), [searchQuery, viewId]);

  const { data: resRowCount } = useQuery({
    queryKey: ReactQueryKeys.rowCount(tableId as string, rowCountQuery),
    queryFn: ({ queryKey }) => getRowCount(queryKey[1], queryKey[2]).then((data) => data.data),
    enabled: !!tableId && isHydrated,
    refetchOnWindowFocus: false,
  });

  const updateRowCount = useCallback(
    (cleanAll?: boolean) =>
      queryClient.invalidateQueries(
        ReactQueryKeys.rowCount(tableId as string, rowCountQuery).slice(0, cleanAll ? 2 : 3)
      ),
    [queryClient, tableId, rowCountQuery]
  );

  const updateRowCountForTable = useCallback(() => {
    console.log('updateRowCountForTable');
    updateRowCount(true);
  }, [updateRowCount]);

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['setRecord', 'addRecord', 'deleteRecord'],
    []
  );
  useTableListener(tableId, tableMatches, updateRowCountForTable);

  const viewMatches = useMemo<IViewActionKey[]>(() => ['applyViewFilter'], []);
  useViewListener(viewId, viewMatches, updateRowCount);

  const rowCount = useMemo(() => {
    if (!resRowCount) return 0;

    const { rowCount } = resRowCount;
    return rowCount;
  }, [resRowCount]);
  return <RowCountContext.Provider value={rowCount}>{children}</RowCountContext.Provider>;
};
