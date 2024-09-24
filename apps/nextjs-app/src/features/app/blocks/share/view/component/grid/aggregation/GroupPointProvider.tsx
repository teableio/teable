import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IKanbanViewOptions, ITableActionKey, IViewActionKey } from '@teable/core';
import { SortFunc, ViewType } from '@teable/core';
import { getShareViewGroupPoints } from '@teable/openapi';
import {
  ReactQueryKeys,
  GroupPointContext,
  useView,
  useSearch,
  useTableListener,
  useViewListener,
  ShareViewContext,
} from '@teable/sdk';
import type { ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';

interface GroupPointProviderProps {
  children: ReactNode;
}

export const GroupPointProvider = ({ children }: GroupPointProviderProps) => {
  const { tableId, viewId, shareId } = useContext(ShareViewContext);
  const queryClient = useQueryClient();
  const view = useView(viewId);
  const { searchQuery } = useSearch();
  const { type, filter, group, options } = view || {};

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
      filter,
      groupBy,
      search: searchQuery,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, JSON.stringify(groupBy), searchQuery]);

  const { data: resGroupPoints } = useQuery({
    queryKey: ReactQueryKeys.shareViewGroupPoints(shareId, query),
    queryFn: ({ queryKey }) =>
      getShareViewGroupPoints(queryKey[1], queryKey[2]).then((data) => data.data),
    enabled: Boolean(tableId && groupBy?.length),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const updateGroupPoints = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.shareViewGroupPoints(shareId, query)),
    [query, queryClient, shareId]
  );

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['setRecord', 'addRecord', 'deleteRecord', 'setField'],
    []
  );
  useTableListener(tableId, tableMatches, updateGroupPoints);

  const viewMatches = useMemo<IViewActionKey[]>(() => ['applyViewFilter'], []);
  useViewListener(viewId, viewMatches, updateGroupPoints);

  const groupPoints = useMemo(() => resGroupPoints || null, [resGroupPoints]);

  return <GroupPointContext.Provider value={groupPoints}>{children}</GroupPointContext.Provider>;
};
