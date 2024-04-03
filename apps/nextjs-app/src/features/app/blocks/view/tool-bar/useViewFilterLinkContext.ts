import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getViewFilterLinkRecords } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useActionTrigger } from '@teable/sdk/hooks';
import { useCallback, useEffect } from 'react';

export const useViewFilterLinkContext = (
  tableId: string | undefined,
  viewId: string | undefined,
  config: { disabled?: boolean }
) => {
  const { disabled } = config;
  const queryClient = useQueryClient();
  const enabledQuery = Boolean(!disabled && tableId && viewId);

  const { listener } = useActionTrigger();

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
    if (!tableId || !viewId || !enabledQuery) return;

    listener?.(['applyViewFilter'], () => updateContext(), [tableId, viewId]);
  }, [enabledQuery, listener, tableId, updateContext, viewId]);

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
