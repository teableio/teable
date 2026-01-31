import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ITableActionKey, IViewActionKey } from '@teable/core';
import type { IQueryBaseRo } from '@teable/openapi';
import { getRowCount, getShareViewRowCount } from '@teable/openapi';
import { throttle } from 'lodash';
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
import { useDocumentVisible } from '../../hooks/use-document-visible';
import { AnchorContext } from '../anchor';
import { ShareViewContext } from '../table/ShareViewContext';
import { RowCountContext } from './RowCountContext';

interface RowCountProviderProps {
  children: ReactNode;
  query?: IQueryBaseRo;
}

const THROTTLE_TIME = 2000;

export const RowCountProvider: FC<RowCountProviderProps> = ({ children, query }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const queryClient = useQueryClient();
  const { searchQuery } = useSearch();
  const { shareId } = useContext(ShareViewContext);
  const { selectedRecordIds, filterLinkCellCandidate, filterLinkCellSelected } = useLinkFilter();
  const visible = useDocumentVisible();
  const view = useView();

  const rowCountQuery = useMemo(
    () => ({
      viewId,
      search: searchQuery,
      selectedRecordIds,
      filterLinkCellCandidate,
      filterLinkCellSelected,
      filter: shareId ? view?.filter : undefined,
      ...query,
    }),
    [
      viewId,
      searchQuery,
      selectedRecordIds,
      filterLinkCellCandidate,
      filterLinkCellSelected,
      shareId,
      view?.filter,
      query,
    ]
  );
  const ignoreViewQuery = rowCountQuery?.ignoreViewQuery ?? false;

  const prevQueryRef = useRef(rowCountQuery);

  // Use different query keys for common and share queries to avoid conflicts
  const commonRowCountQueryKey = useMemo(() => {
    prevQueryRef.current = rowCountQuery;
    return ReactQueryKeys.rowCount(tableId as string, rowCountQuery);
  }, [rowCountQuery, tableId]);

  const shareRowCountQueryKey = useMemo(() => {
    return ReactQueryKeys.shareViewRowCount(shareId as string, rowCountQuery);
  }, [rowCountQuery, shareId]);

  const { data: commonRowCount } = useQuery<{ rowCount: number }>({
    queryKey: commonRowCountQueryKey,
    queryFn: () => getRowCount(tableId as string, rowCountQuery).then((data) => data.data),
    enabled: Boolean(!shareId && tableId && isHydrated && visible),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: keepPreviousData,
  });

  const { data: shareRowCount } = useQuery<{ rowCount: number }>({
    queryKey: shareRowCountQueryKey,
    queryFn: () => getShareViewRowCount(shareId as string, rowCountQuery).then((data) => data.data),
    enabled: Boolean(shareId && tableId && isHydrated && visible),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: keepPreviousData,
  });

  const resRowCount = shareId ? shareRowCount : commonRowCount;

  const activeQueryKey = shareId ? shareRowCountQueryKey : commonRowCountQueryKey;

  const updateRowCount = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: activeQueryKey.slice(0, 3),
      }),
    [queryClient, activeQueryKey]
  );

  const throttleUpdateRowCount = useMemo(() => {
    return throttle(updateRowCount, THROTTLE_TIME);
  }, [updateRowCount]);

  const updateRowCountForTable = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: activeQueryKey.slice(0, 2),
    });
  }, [queryClient, activeQueryKey]);

  const throttleUpdateRowCountForTable = useMemo(() => {
    return throttle(updateRowCountForTable, THROTTLE_TIME);
  }, [updateRowCountForTable]);

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['setRecord', 'addRecord', 'deleteRecord'],
    []
  );
  useTableListener(tableId, tableMatches, throttleUpdateRowCountForTable);

  const viewMatches = useMemo<IViewActionKey[]>(
    () => (ignoreViewQuery ? [] : ['applyViewFilter']),
    [ignoreViewQuery]
  );
  useViewListener(viewId, viewMatches, throttleUpdateRowCount);

  const rowCount = useMemo(() => {
    if (!resRowCount) return null;

    const { rowCount } = resRowCount;
    return rowCount;
  }, [resRowCount]);
  return <RowCountContext.Provider value={rowCount}>{children}</RowCountContext.Provider>;
};
