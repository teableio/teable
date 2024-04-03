import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IKanbanViewOptions } from '@teable/core';
import { SortFunc, ViewType } from '@teable/core';
import { getShareViewGroupPoints } from '@teable/openapi';
import type { PropKeys } from '@teable/sdk';
import {
  ReactQueryKeys,
  useActionTrigger,
  GroupPointContext,
  useView,
  useSearch,
} from '@teable/sdk';
import type { ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ShareViewPageContext } from '../../../ShareViewPageContext';

interface GroupPointProviderProps {
  children: ReactNode;
}

export const GroupPointProvider = ({ children }: GroupPointProviderProps) => {
  const { tableId, viewId, shareId } = useContext(ShareViewPageContext);
  const { listener } = useActionTrigger();
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
    queryFn: ({ queryKey }) => getShareViewGroupPoints(queryKey[1], queryKey[2]),
    enabled: Boolean(tableId && groupBy?.length),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const updateGroupPoints = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.shareViewGroupPoints(shareId, query)),
    [query, queryClient, shareId]
  );

  useEffect(() => {
    if (tableId == null) return;

    const relevantProps: PropKeys[] = ['addRecord', 'deleteRecord', 'setRecord', 'applyViewFilter'];

    listener?.(relevantProps, () => updateGroupPoints(), [tableId, viewId]);
  }, [listener, tableId, updateGroupPoints, viewId]);

  const groupPoints = useMemo(() => resGroupPoints?.data || null, [resGroupPoints]);

  return <GroupPointContext.Provider value={groupPoints}>{children}</GroupPointContext.Provider>;
};
