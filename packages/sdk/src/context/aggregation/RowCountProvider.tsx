import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ITableActionKey, IViewActionKey } from '@teable/core';
import type { IQueryBaseRo } from '@teable/openapi';
import { getRowCount, getShareViewRowCount } from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo, useRef } from 'react';
import { ReactQueryKeys } from '../../config';
import {
  useIsHydrated,
  useLinkFilter,
  useSearch,
  useTableListener,
  useView,
  useViewListener,
} from '../../hooks';
import { AnchorContext } from '../anchor';
import { ShareViewContext } from '../table/ShareViewContext';
import { RowCountContext } from './RowCountContext';

interface RowCountProviderProps {
  children: ReactNode;
  query?: IQueryBaseRo;
}

export const RowCountProvider: FC<RowCountProviderProps> = ({ children, query }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const queryClient = useQueryClient();
  const { searchQuery } = useSearch();
  const { shareId } = useContext(ShareViewContext);
  const { selectedRecordIds, filterLinkCellCandidate } = useLinkFilter();

  const view = useView();

  const rowCountQuery = useMemo(
    () => ({
      viewId,
      search: searchQuery,
      selectedRecordIds,
      filterLinkCellCandidate,
      filter: shareId ? view?.filter : undefined,
      ...query,
    }),
    [viewId, searchQuery, selectedRecordIds, filterLinkCellCandidate, shareId, view?.filter, query]
  );

  const prevQueryRef = useRef(rowCountQuery);

  const rowCountQueryKey = useMemo(() => {
    prevQueryRef.current = rowCountQuery;
    return ReactQueryKeys.rowCount(shareId || (tableId as string), rowCountQuery);
  }, [rowCountQuery, shareId, tableId]);

  const { data: commonRowCount } = useQuery({
    queryKey: rowCountQueryKey,
    queryFn: ({ queryKey }) => getRowCount(queryKey[1], queryKey[2]).then((data) => data.data),
    enabled: Boolean(!shareId && tableId && isHydrated),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    keepPreviousData: true,
  });

  const { data: shareRowCount } = useQuery({
    queryKey: rowCountQueryKey,
    queryFn: ({ queryKey }) =>
      getShareViewRowCount(queryKey[1], queryKey[2]).then((data) => data.data),
    enabled: Boolean(shareId && tableId && isHydrated),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    keepPreviousData: true,
  });

  const resRowCount = shareId ? shareRowCount : commonRowCount;

  const updateRowCount = useCallback(
    (cleanAll?: boolean) =>
      queryClient.invalidateQueries({
        queryKey: rowCountQueryKey.slice(0, cleanAll ? 2 : 3),
      }),
    [queryClient, rowCountQueryKey]
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
