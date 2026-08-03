import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import type { IFilter, ITableActionKey, IViewActionKey } from '@teable/core';
import type { IRowCountRo } from '@teable/openapi';
import { getRowCount, getShareViewRowCount } from '@teable/openapi';
import { throttle } from 'lodash';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo, useRef } from 'react';
import { ReactQueryKeys } from '../../config';
import {
  useIsHydrated,
  useLinkFilter,
  useSearch,
  useServerViewFilter,
  useView,
  useViewListener,
} from '../../hooks';
import { useDocumentVisible } from '../../hooks/use-document-visible';
import {
  collectRelevantFieldIds,
  useFieldAwareTableListener,
} from '../../hooks/use-field-aware-table-listener';
import { AnchorContext } from '../anchor';
import { ShareViewContext } from '../table/ShareViewContext';
import { RowCountContext } from './RowCountContext';
import { useShareAwareQuery } from './use-share-aware-query';

interface RowCountProviderProps {
  children: ReactNode;
  query?: IRowCountRo;
}

const THROTTLE_TIME = 2000;

export const RowCountProvider: FC<RowCountProviderProps> = ({ children, query }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const queryClient = useQueryClient();
  const { filteringSearchQuery } = useSearch();
  const { shareId } = useContext(ShareViewContext);
  const { selectedRecordIds, filterLinkCellCandidate, filterLinkCellSelected } = useLinkFilter();
  const visible = useDocumentVisible();
  const view = useView();

  const rowCountQuery = useMemo(
    () => ({
      viewId,
      search: filteringSearchQuery,
      selectedRecordIds,
      filterLinkCellCandidate,
      filterLinkCellSelected,
      filter: shareId ? view?.filter : undefined,
      ...query,
    }),
    [
      viewId,
      filteringSearchQuery,
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

  const { data: resRowCount, activeQueryKey } = useShareAwareQuery<{ rowCount: number }>({
    shareId,
    enabled: Boolean(tableId && isHydrated && visible),
    common: {
      queryKey: commonRowCountQueryKey,
      queryFn: () => getRowCount(tableId as string, rowCountQuery).then((data) => data.data),
    },
    share: {
      queryKey: shareRowCountQueryKey,
      queryFn: () =>
        getShareViewRowCount(shareId as string, rowCountQuery).then((data) => data.data),
    },
    options: { placeholderData: keepPreviousData },
  });

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

  const serverViewFilter = useServerViewFilter();

  const relevantFieldIds = useMemo(
    () =>
      collectRelevantFieldIds({
        queryFilter: rowCountQuery.filter as IFilter | undefined,
        viewFilter: serverViewFilter,
        search: rowCountQuery.search,
        filterLinkCellCandidate: rowCountQuery.filterLinkCellCandidate,
        filterLinkCellSelected: rowCountQuery.filterLinkCellSelected,
      }),
    [rowCountQuery, serverViewFilter]
  );

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['setRecord', 'addRecord', 'deleteRecord'],
    []
  );
  useFieldAwareTableListener(
    tableId,
    tableMatches,
    relevantFieldIds,
    throttleUpdateRowCountForTable
  );

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
