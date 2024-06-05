import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IViewActionKey } from '@teable/core';
import { getViewFilterLinkRecords } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useActionPresence } from '@teable/sdk/hooks/use-presence';
import { useCallback, useEffect } from 'react';

export const useViewFilterLinkContext = (
  tableId: string | undefined,
  viewId: string | undefined,
  config: { disabled?: boolean }
) => {
  const { disabled } = config;
  const queryClient = useQueryClient();
  const enabledQuery = Boolean(!disabled && tableId && viewId);

  const viewPresence = useActionPresence(viewId);

  const { isLoading, data: queryData } = useQuery({
    queryKey: ReactQueryKeys.getViewFilterLinkRecords(tableId!, viewId!),
    queryFn: ({ queryKey }) => getViewFilterLinkRecords(queryKey[1], queryKey[2]),
    enabled: enabledQuery,
  });

  const updateContext = useCallback(() => {
    if (enabledQuery) {
      tableId &&
        viewId &&
        queryClient.invalidateQueries(ReactQueryKeys.getViewFilterLinkRecords(tableId, viewId));
    }
  }, [enabledQuery, queryClient, tableId, viewId]);

  useEffect(() => {
    if (viewId == null || !viewPresence || !enabledQuery) return;

    const cb = (_id: string, res: IViewActionKey[]) =>
      res.some((action) => action === 'applyViewFilter') && updateContext();

    viewPresence.addListener('receive', cb);

    return () => {
      viewPresence.removeListener('receive', cb);
    };
  }, [viewPresence, viewId, updateContext, enabledQuery]);

  return {
    isLoading,
    data: queryData?.data?.map((v) => ({
      tableId: v.tableId,
      data: v.records.reduce(
        (acc, cur) => {
          acc[cur.id] = cur.title;
          return acc;
        },
        {} as Record<string, string | undefined>
      ),
    })),
  };
};
