import { useQueryClient } from '@tanstack/react-query';
import type { IFilter, IKanbanViewOptions, ITableActionKey, IViewActionKey } from '@teable/core';
import { SortFunc, ViewType } from '@teable/core';
import type { IGroupPointsRo } from '@teable/openapi';
import { getGroupPoints, getShareViewGroupPoints } from '@teable/openapi';
import { throttle } from 'lodash';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import {
  useIsHydrated,
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
import { GroupPointContext } from './GroupPointContext';
import { useShareAwareQuery } from './use-share-aware-query';

interface GroupPointProviderProps {
  children: ReactNode;
  query?: IGroupPointsRo;
}

const THROTTLE_TIME = 2000;

export const GroupPointProvider: FC<GroupPointProviderProps> = ({ children, query }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const { shareId } = useContext(ShareViewContext);
  const queryClient = useQueryClient();
  const view = useView(viewId);
  const { filteringSearchQuery } = useSearch();
  const { type, group, options } = view || {};
  const visible = useDocumentVisible();

  const groupBy = useMemo(() => {
    if (type === ViewType.Kanban) {
      const { stackFieldId } = (options ?? {}) as IKanbanViewOptions;
      if (stackFieldId == null) return;
      return [{ order: SortFunc.Asc, fieldId: stackFieldId }];
    }
    return group;
  }, [group, options, type]);

  const groupPointQuery = useMemo(() => {
    return {
      viewId,
      groupBy,
      search: filteringSearchQuery,
      // the visitor's local filter only exists on the proxied view and must
      // travel with the share query
      filter: shareId ? view?.filter : query?.filter,
      ignoreViewQuery: query?.ignoreViewQuery,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, JSON.stringify(groupBy), filteringSearchQuery, query, shareId, view?.filter]);

  const ignoreViewQuery = groupPointQuery?.ignoreViewQuery ?? false;

  // Use different query keys for common and share queries to avoid conflicts
  const commonQueryKey = useMemo(
    () => ReactQueryKeys.groupPoints(tableId as string, groupPointQuery),
    [tableId, groupPointQuery]
  );
  const shareQueryKey = useMemo(
    () => ReactQueryKeys.shareViewGroupPoints(shareId as string, groupPointQuery),
    [shareId, groupPointQuery]
  );

  const { data: resGroupPoints, activeQueryKey } = useShareAwareQuery({
    shareId,
    enabled: Boolean(tableId && isHydrated && groupBy?.length) && visible,
    common: {
      queryKey: commonQueryKey,
      queryFn: () => getGroupPoints(tableId as string, groupPointQuery).then((data) => data.data),
    },
    share: {
      queryKey: shareQueryKey,
      queryFn: () =>
        getShareViewGroupPoints(shareId as string, groupPointQuery).then((data) => data.data),
    },
    options: { retry: 1 },
  });

  const updateGroupPoints = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: activeQueryKey.slice(0, 3),
      }),
    [queryClient, activeQueryKey]
  );

  const throttleUpdateGroupPoints = useMemo(() => {
    return throttle(updateGroupPoints, THROTTLE_TIME);
  }, [updateGroupPoints]);

  const updateGroupPointsForTable = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: activeQueryKey.slice(0, 2),
      }),
    [queryClient, activeQueryKey]
  );

  const throttleUpdateGroupPointsForTable = useMemo(() => {
    return throttle(updateGroupPointsForTable, THROTTLE_TIME);
  }, [updateGroupPointsForTable]);

  const serverViewFilter = useServerViewFilter();

  const relevantFieldIds = useMemo(
    () =>
      collectRelevantFieldIds({
        queryFilter: groupPointQuery.filter as IFilter | undefined,
        viewFilter: serverViewFilter,
        search: groupPointQuery.search,
        groupBy,
      }),
    [groupBy, serverViewFilter, groupPointQuery]
  );

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['setRecord', 'addRecord', 'deleteRecord', 'setField'],
    []
  );
  useFieldAwareTableListener(
    tableId,
    tableMatches,
    relevantFieldIds,
    throttleUpdateGroupPointsForTable
  );

  const viewMatches = useMemo<IViewActionKey[]>(
    () => (ignoreViewQuery ? [] : ['applyViewFilter']),
    [ignoreViewQuery]
  );
  useViewListener(viewId, viewMatches, throttleUpdateGroupPoints);

  const groupPoints = useMemo(() => resGroupPoints || null, [resGroupPoints]);

  return <GroupPointContext.Provider value={groupPoints}>{children}</GroupPointContext.Provider>;
};
