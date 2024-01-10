import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getShareViewGroupPoints } from '@teable-group/openapi';
import type { PropKeys } from '@teable-group/sdk';
import { ReactQueryKeys, useActionTrigger, GroupPointContext, useView } from '@teable-group/sdk';
import type { ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ShareViewPageContext } from '../../../ShareViewPageContext';

interface GroupPointProviderProps {
  children: ReactNode;
}

const useGroupPointsQuery = () => {
  const view = useView();
  const { filter, group } = view || {};

  return useMemo(
    () => ({
      filter,
      groupBy: group,
    }),
    [filter, group]
  );
};

export const GroupPointProvider = ({ children }: GroupPointProviderProps) => {
  const { tableId, viewId, shareId } = useContext(ShareViewPageContext);
  const { listener } = useActionTrigger();
  const queryClient = useQueryClient();
  const query = useGroupPointsQuery();

  const { data: resGroupPoints } = useQuery({
    queryKey: ReactQueryKeys.shareViewGroupPoints(shareId, query),
    queryFn: ({ queryKey }) => getShareViewGroupPoints(queryKey[1], queryKey[2]),
    refetchOnWindowFocus: false,
  });

  const updateGroupPoints = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.shareViewGroupPoints(shareId, query)),
    [query, queryClient, shareId]
  );

  useEffect(() => {
    if (tableId == null) return;

    const relevantProps = [
      'tableAdd',
      'tableDelete',
      'tableUpdate',
      'applyViewFilter',
      'applyViewGroup',
    ] as PropKeys[];

    listener?.(relevantProps, () => updateGroupPoints(), [tableId, viewId]);
  }, [listener, tableId, updateGroupPoints, viewId]);

  const groupPoints = useMemo(() => resGroupPoints?.data || null, [resGroupPoints]);

  return <GroupPointContext.Provider value={groupPoints}>{children}</GroupPointContext.Provider>;
};
