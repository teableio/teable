import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAggregation } from '@teable-group/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ReactQueryKeys } from '../../config/react-query-keys';
import { useIsHydrated, useActionTrigger } from '../../hooks';
import { AnchorContext } from '../anchor';
import { AggregationContext } from './AggregationContext';

interface IAggregationProviderProps {
  children: ReactNode;
}

export const AggregationProvider: FC<IAggregationProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const queryClient = useQueryClient();

  const pullAction = useActionTrigger();

  const { data: resAggregations } = useQuery({
    queryKey: ReactQueryKeys.aggregation(tableId as string, { viewId }),
    queryFn: ({ queryKey }) => getAggregation(queryKey[1], queryKey[2]),
    enabled: !!tableId && isHydrated,
    refetchOnWindowFocus: false,
  });

  const updateAggregations = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.aggregation(tableId as string, { viewId })),
    [queryClient, tableId, viewId]
  );

  useEffect(() => {
    if (pullAction?.fetchAggregation) {
      updateAggregations();
    }
  }, [pullAction, updateAggregations]);

  const aggregations = useMemo(() => {
    if (!resAggregations) return {};

    const { aggregations } = resAggregations.data;
    return {
      aggregations: aggregations ?? [],
    };
  }, [resAggregations]);
  return <AggregationContext.Provider value={aggregations}>{children}</AggregationContext.Provider>;
};
