import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IActionTriggerBuffer } from '@teable/core';
import { getAggregation } from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useActionTrigger, useIsHydrated, useSearch } from '../../hooks';
import { AnchorContext } from '../anchor';
import { AggregationContext } from './AggregationContext';

type PropKeys = keyof IActionTriggerBuffer;

interface IAggregationProviderProps {
  children: ReactNode;
}

export const AggregationProvider: FC<IAggregationProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const { listener } = useActionTrigger();
  const queryClient = useQueryClient();
  const { searchQuery } = useSearch();
  const aggQuery = useMemo(() => ({ viewId, search: searchQuery }), [searchQuery, viewId]);
  const { data: resAggregations } = useQuery({
    queryKey: ReactQueryKeys.aggregations(tableId as string, aggQuery),
    queryFn: ({ queryKey }) => getAggregation(queryKey[1], queryKey[2]),
    enabled: !!tableId && isHydrated,
    refetchOnWindowFocus: false,
  });

  const updateAggregations = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.aggregations(tableId as string, aggQuery)),
    [aggQuery, queryClient, tableId]
  );

  useEffect(() => {
    if (tableId == null) return;

    const relevantProps: PropKeys[] = [
      'addRecord',
      'setRecord',
      'deleteRecord',
      'applyViewFilter',
      'showViewField',
      'applyViewStatisticFunc',
    ];

    listener?.(relevantProps, () => updateAggregations(), [tableId, viewId]);
  }, [listener, tableId, updateAggregations, viewId]);

  const aggregations = useMemo(() => {
    if (!resAggregations) return {};

    const { aggregations } = resAggregations.data;
    return {
      aggregations: aggregations ?? [],
    };
  }, [resAggregations]);
  return <AggregationContext.Provider value={aggregations}>{children}</AggregationContext.Provider>;
};
