import { useQuery, useQueryClient } from '@tanstack/react-query';
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

const useGroupPointsQuery = () => {
  const view = useView();
  const { filter, group } = view || {};
  const { searchQuery } = useSearch();
  return useMemo(
    () => ({
      filter,
      groupBy: group,
      search: searchQuery,
    }),
    [filter, group, searchQuery]
  );
};

export const GroupPointProvider = ({ children }: GroupPointProviderProps) => {
  const { tableId, viewId, shareId } = useContext(ShareViewPageContext);
  const { listener } = useActionTrigger();
  const queryClient = useQueryClient();
  const query = useGroupPointsQuery();
  const view = useView(viewId);
  const group = view?.group;

  const { data: resGroupPoints } = useQuery({
    queryKey: ReactQueryKeys.shareViewGroupPoints(shareId, query),
    queryFn: ({ queryKey }) => getShareViewGroupPoints(queryKey[1], queryKey[2]),
    enabled: !!tableId && !!group?.length,
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
