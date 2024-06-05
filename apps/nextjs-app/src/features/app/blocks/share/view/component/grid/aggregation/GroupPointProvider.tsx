import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IKanbanViewOptions, ITableActionKey, IViewActionKey } from '@teable/core';
import { SortFunc, ViewType } from '@teable/core';
import { getShareViewGroupPoints } from '@teable/openapi';
import { ReactQueryKeys, GroupPointContext, useView, useSearch } from '@teable/sdk';
import { useActionPresence } from '@teable/sdk/hooks/use-presence';
import type { ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ShareViewPageContext } from '../../../ShareViewPageContext';

interface GroupPointProviderProps {
  children: ReactNode;
}

export const GroupPointProvider = ({ children }: GroupPointProviderProps) => {
  const { tableId, viewId, shareId } = useContext(ShareViewPageContext);
  const queryClient = useQueryClient();
  const view = useView(viewId);
  const tablePresence = useActionPresence(tableId);
  const viewPresence = useActionPresence(viewId);
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
    if (tableId == null || !tablePresence) return;

    const relevantProps = new Set<ITableActionKey>([
      'setRecord',
      'addRecord',
      'deleteRecord',
      'setField',
    ]);
    const cb = (_id: string, res: ITableActionKey[]) =>
      res.some((action) => relevantProps.has(action)) && updateGroupPoints();

    tablePresence.addListener('receive', cb);

    return () => {
      tablePresence.removeListener('receive', cb);
    };
  }, [tablePresence, tableId, updateGroupPoints]);

  useEffect(() => {
    if (viewId == null || !viewPresence) return;

    const cb = (_id: string, res: IViewActionKey[]) =>
      res.some((action) => action === 'applyViewFilter') && updateGroupPoints();

    viewPresence.addListener('receive', cb);

    return () => {
      viewPresence.removeListener('receive', cb);
    };
  }, [viewPresence, viewId, updateGroupPoints]);

  const groupPoints = useMemo(() => resGroupPoints?.data || null, [resGroupPoints]);

  return <GroupPointContext.Provider value={groupPoints}>{children}</GroupPointContext.Provider>;
};
