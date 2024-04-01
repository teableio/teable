import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IKanbanViewOptions } from '@teable/core';
import { SortFunc, ViewType } from '@teable/core';
import { getGroupPoints } from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useActionTrigger, useIsHydrated, useView } from '../../hooks';
import type { PropKeys } from '../action-trigger';
import { AnchorContext } from '../anchor';
import { GroupPointContext } from './GroupPointContext';

interface GroupPointProviderProps {
  children: ReactNode;
}

export const GroupPointProvider: FC<GroupPointProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const { listener } = useActionTrigger();
  const queryClient = useQueryClient();
  const view = useView(viewId);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, JSON.stringify(groupBy)]);

  const { data: resGroupPoints } = useQuery({
    queryKey: ReactQueryKeys.groupPoints(tableId as string, query),
    queryFn: ({ queryKey }) => getGroupPoints(queryKey[1], queryKey[2]),
    enabled: Boolean(tableId && isHydrated && groupBy?.length),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const updateGroupPoints = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.groupPoints(tableId as string, query)),
    [query, queryClient, tableId]
  );

  useEffect(() => {
    if (tableId == null) return;

    const relevantProps: PropKeys[] = ['addRecord', 'deleteRecord', 'setRecord', 'applyViewFilter'];

    listener?.(relevantProps, () => updateGroupPoints(), [tableId, viewId]);
  }, [listener, tableId, updateGroupPoints, viewId]);

  const groupPoints = useMemo(() => resGroupPoints?.data || null, [resGroupPoints]);

  return <GroupPointContext.Provider value={groupPoints}>{children}</GroupPointContext.Provider>;
};
