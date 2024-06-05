import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ITableActionKey, IViewActionKey } from '@teable/core';
import type { IShareViewRowCountRo } from '@teable/openapi';
import { getShareViewRowCount } from '@teable/openapi';
import { RowCountContext, ReactQueryKeys } from '@teable/sdk';
import { useSearch, useView } from '@teable/sdk/hooks';
import { useActionPresence } from '@teable/sdk/hooks/use-presence';
import type { ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ShareViewPageContext } from '../../../ShareViewPageContext';

interface IRowCountProviderProps {
  children: ReactNode;
}

const useRowCountQuery = (): IShareViewRowCountRo => {
  const view = useView();
  const { searchQuery } = useSearch();
  return useMemo(
    () => ({ filter: view?.filter, search: searchQuery }),
    [view?.filter, searchQuery]
  );
};

export const RowCountProvider = ({ children }: IRowCountProviderProps) => {
  const { tableId, viewId, shareId } = useContext(ShareViewPageContext);
  const tablePresence = useActionPresence(tableId);
  const viewPresence = useActionPresence(viewId);
  const queryClient = useQueryClient();
  const query = useRowCountQuery();

  const { data: shareViewRowCount } = useQuery({
    queryKey: ReactQueryKeys.shareViewRowCount(shareId, query),
    queryFn: ({ queryKey }) => getShareViewRowCount(queryKey[1], queryKey[2]),
    refetchOnWindowFocus: false,
  });

  const updateViewRowCount = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.shareViewRowCount(shareId, query)),
    [query, queryClient, shareId]
  );

  useEffect(() => {
    if (tableId == null || !tablePresence) return;

    const relevantProps = new Set<ITableActionKey>(['setRecord', 'addRecord', 'deleteRecord']);
    const cb = (_id: string, res: ITableActionKey[]) =>
      res.some((action) => relevantProps.has(action)) && updateViewRowCount();

    tablePresence.addListener('receive', cb);

    return () => {
      tablePresence.removeListener('receive', cb);
    };
  }, [tablePresence, tableId, updateViewRowCount]);

  useEffect(() => {
    if (viewId == null || !viewPresence) return;

    const cb = (_id: string, res: IViewActionKey[]) =>
      res.some((action) => action === 'applyViewFilter') && updateViewRowCount();

    viewPresence.addListener('receive', cb);

    return () => {
      viewPresence.removeListener('receive', cb);
    };
  }, [viewPresence, viewId, updateViewRowCount]);

  const rowCount = useMemo(() => {
    if (!shareViewRowCount) {
      return null;
    }
    return shareViewRowCount.data.rowCount;
  }, [shareViewRowCount]);

  return <RowCountContext.Provider value={rowCount}>{children}</RowCountContext.Provider>;
};
