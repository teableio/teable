import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getGroupPoints } from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useActionTrigger, useIsHydrated, useSearch, useView } from '../../hooks';
import type { PropKeys } from '../action-trigger';
import { AnchorContext } from '../anchor';
import { GroupPointContext } from './GroupPointContext';

interface GroupPointProviderProps {
  children: ReactNode;
}

const useGroupPointsQuery = () => {
  const view = useView();
  const { searchQuery } = useSearch();

  const { id: viewId, group } = view || {};

  return useMemo(
    () => ({ viewId, groupBy: group, search: searchQuery }),
    [searchQuery, group, viewId]
  );
};

export const GroupPointProvider: FC<GroupPointProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const { listener } = useActionTrigger();
  const queryClient = useQueryClient();
  const query = useGroupPointsQuery();
  const view = useView(viewId);
  const group = view?.group;

  const { data: resGroupPoints } = useQuery({
    queryKey: ReactQueryKeys.groupPoints(tableId as string, query),
    queryFn: ({ queryKey }) => getGroupPoints(queryKey[1], queryKey[2]),
    enabled: !!tableId && isHydrated && !!group?.length,
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
