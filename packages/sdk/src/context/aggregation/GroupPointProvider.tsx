import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IKanbanViewOptions, ITableActionKey, IViewActionKey } from '@teable/core';
import { SortFunc, ViewType } from '@teable/core';
import { getGroupPoints } from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useIsHydrated, useSearch, useTableListener, useView, useViewListener } from '../../hooks';
import { AnchorContext } from '../anchor';
import { GroupPointContext } from './GroupPointContext';

interface GroupPointProviderProps {
  children: ReactNode;
}

export const GroupPointProvider: FC<GroupPointProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const queryClient = useQueryClient();
  const view = useView(viewId);
  const { searchQuery } = useSearch();
  const { type, group, options } = view || {};

  const groupBy = useMemo(() => {
    if (type === ViewType.Kanban) {
      const { stackFieldId } = (options ?? {}) as IKanbanViewOptions;
      if (stackFieldId == null) return;
      return [{ order: SortFunc.Asc, fieldId: stackFieldId }];
    }
    return group;
  }, [group, options, type]);

  const query = useMemo(() => {
    return {
      viewId,
      groupBy,
      search: searchQuery,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, JSON.stringify(groupBy), searchQuery]);

  const { data: resGroupPoints } = useQuery({
    queryKey: ReactQueryKeys.groupPoints(tableId as string, query),
    queryFn: ({ queryKey }) => getGroupPoints(queryKey[1], queryKey[2]),
    enabled: Boolean(tableId && isHydrated && groupBy?.length),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const updateGroupPoints = useCallback(
    (cleanAll?: boolean) =>
      queryClient.invalidateQueries(
        ReactQueryKeys.groupPoints(tableId as string, query).slice(0, cleanAll ? 2 : 3)
      ),
    [query, queryClient, tableId]
  );

  const updateGroupPointsForTable = useCallback(() => updateGroupPoints(true), [updateGroupPoints]);

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['setRecord', 'addRecord', 'deleteRecord', 'setField'],
    []
  );
  useTableListener(tableId, tableMatches, updateGroupPointsForTable);

  const viewMatches = useMemo<IViewActionKey[]>(() => ['applyViewFilter'], []);
  useViewListener(viewId, viewMatches, updateGroupPoints);

  const groupPoints = useMemo(() => resGroupPoints?.data || null, [resGroupPoints]);

  return <GroupPointContext.Provider value={groupPoints}>{children}</GroupPointContext.Provider>;
};
