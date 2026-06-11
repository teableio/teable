import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IFilter, IKanbanViewOptions, ITableActionKey, IViewActionKey } from '@teable/core';
import { SortFunc, ViewType } from '@teable/core';
import type { IGroupPointsRo } from '@teable/openapi';
import { getGroupPoints } from '@teable/openapi';
import { throttle } from 'lodash';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useIsHydrated, useSearch, useView, useViewListener } from '../../hooks';
import { useDocumentVisible } from '../../hooks/use-document-visible';
import {
  collectRelevantFieldIds,
  useFieldAwareTableListener,
} from '../../hooks/use-field-aware-table-listener';
import { AnchorContext } from '../anchor';
import { GroupPointContext } from './GroupPointContext';

interface GroupPointProviderProps {
  children: ReactNode;
  query?: IGroupPointsRo;
}

const THROTTLE_TIME = 2000;

export const GroupPointProvider: FC<GroupPointProviderProps> = ({ children, query }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
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
      filter: query?.filter,
      ignoreViewQuery: query?.ignoreViewQuery,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, JSON.stringify(groupBy), filteringSearchQuery, query]);

  const ignoreViewQuery = groupPointQuery?.ignoreViewQuery ?? false;
  const { data: resGroupPoints } = useQuery({
    queryKey: ReactQueryKeys.groupPoints(tableId as string, groupPointQuery),
    queryFn: ({ queryKey }) => getGroupPoints(queryKey[1], queryKey[2]).then((data) => data.data),
    enabled: Boolean(tableId && isHydrated && groupBy?.length) && visible,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
  });

  const updateGroupPoints = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.groupPoints(tableId as string, groupPointQuery).slice(0, 3),
      }),
    [groupPointQuery, queryClient, tableId]
  );

  const throttleUpdateGroupPoints = useMemo(() => {
    return throttle(updateGroupPoints, THROTTLE_TIME);
  }, [updateGroupPoints]);

  const updateGroupPointsForTable = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.groupPoints(tableId as string, groupPointQuery).slice(0, 2),
      }),
    [groupPointQuery, queryClient, tableId]
  );

  const throttleUpdateGroupPointsForTable = useMemo(() => {
    return throttle(updateGroupPointsForTable, THROTTLE_TIME);
  }, [updateGroupPointsForTable]);

  const relevantFieldIds = useMemo(
    () =>
      collectRelevantFieldIds({
        queryFilter: groupPointQuery.filter as IFilter | undefined,
        viewFilter: ignoreViewQuery ? undefined : (view?.filter as IFilter | undefined),
        search: groupPointQuery.search,
        groupBy,
      }),
    [groupBy, view?.filter, ignoreViewQuery, groupPointQuery]
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
