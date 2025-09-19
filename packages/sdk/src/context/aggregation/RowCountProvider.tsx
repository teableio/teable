import { useQuery, useQueryClient } from '@tanstack/react-query';
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

  const rowCountQueryKey = useMemo(() => {
    prevQueryRef.current = rowCountQuery;
    return ReactQueryKeys.rowCount(shareId || (tableId as string), rowCountQuery);
  }, [rowCountQuery, shareId, tableId]);

  const { data: commonRowCount } = useQuery({
    queryKey: rowCountQueryKey,
    queryFn: ({ queryKey }) => getRowCount(queryKey[1], queryKey[2]).then((data) => data.data),
    enabled: Boolean(!shareId && tableId && isHydrated && visible),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    keepPreviousData: true,
  });

  const { data: shareRowCount } = useQuery({
    queryKey: rowCountQueryKey,
    queryFn: ({ queryKey }) =>
      getShareViewRowCount(queryKey[1], queryKey[2]).then((data) => data.data),
    enabled: Boolean(shareId && tableId && isHydrated && visible),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    keepPreviousData: true,
  });

  const resRowCount = shareId ? shareRowCount : commonRowCount;

  const updateRowCount = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: rowCountQueryKey.slice(0, 3),
      }),
    [queryClient, rowCountQueryKey]
  );

  const throttleUpdateRowCount = useMemo(() => {
    return throttle(updateRowCount, THROTTLE_TIME);
  }, [updateRowCount]);

  const updateRowCountForTable = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: rowCountQueryKey.slice(0, 2),
    });
  }, [queryClient, rowCountQueryKey]);

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
