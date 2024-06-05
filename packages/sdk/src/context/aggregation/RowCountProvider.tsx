import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ITableActionKey, IViewActionKey } from '@teable/core';
import { getRowCount } from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useIsHydrated, useSearch } from '../../hooks';
import { useActionPresence } from '../../hooks/use-presence';
import { AnchorContext } from '../anchor';
import { RowCountContext } from './RowCountContext';

interface RowCountProviderProps {
  children: ReactNode;
}

export const RowCountProvider: FC<RowCountProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const tablePresence = useActionPresence(tableId);
  const viewPresence = useActionPresence(viewId);
  const queryClient = useQueryClient();
  const { searchQuery } = useSearch();

  const rowCountQuery = useMemo(() => ({ viewId, search: searchQuery }), [searchQuery, viewId]);

  const { data: resRowCount } = useQuery({
    queryKey: ReactQueryKeys.rowCount(tableId as string, rowCountQuery),
    queryFn: ({ queryKey }) => getRowCount(queryKey[1], queryKey[2]),
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

  useEffect(() => {
    if (tableId == null || !tablePresence) return;

    const relevantProps = new Set<ITableActionKey>(['setRecord', 'addRecord', 'deleteRecord']);
    const cb = (_id: string, res: ITableActionKey[]) => {
      console.log(
        'updateRowCount',
        res.some((action) => relevantProps.has(action))
      );
      // clean row count for all views in this table
      res.some((action) => relevantProps.has(action)) && updateRowCount(true);
    };

    tablePresence.addListener('receive', cb);

    return () => {
      tablePresence.removeListener('receive', cb);
    };
  }, [tablePresence, tableId, updateRowCount]);

  useEffect(() => {
    if (viewId == null || !viewPresence) return;

    const cb = (_id: string, res: IViewActionKey[]) =>
      res.some((action) => action === 'applyViewFilter') && updateRowCount();

    viewPresence.addListener('receive', cb);

    return () => {
      viewPresence.removeListener('receive', cb);
    };
  }, [viewPresence, viewId, updateRowCount]);

  const rowCount = useMemo(() => {
    if (!resRowCount) return 0;

    const { rowCount } = resRowCount.data;
    return rowCount;
  }, [resRowCount]);
  return <RowCountContext.Provider value={rowCount}>{children}</RowCountContext.Provider>;
};
