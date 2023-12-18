import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IShareViewAggregationsRo } from '@teable-group/openapi';
import { getShareViewAggregations } from '@teable-group/openapi';
import { useView } from '@teable-group/sdk';
import { AggregationContext } from '@teable-group/sdk/context';
import type { ReactNode } from 'react';
import { useCallback, useContext, useMemo, useRef } from 'react';
import { ShareViewPageContext } from '../../../ShareViewPageContext';

interface IAggregationProviderProps {
  children: ReactNode;
}

const useAggregationQuery = (): IShareViewAggregationsRo => {
  const view = useView();
  return useMemo(() => ({ filter: view?.filter }), [view?.filter]);
};

export const AggregationProvider = ({ children }: IAggregationProviderProps) => {
  const { shareId } = useContext(ShareViewPageContext);
  const queryClient = useQueryClient();
  const query = useAggregationQuery();
  const queryRef = useRef(query);
  queryRef.current = query;
  const { data: shareViewAggregations } = useQuery({
    queryKey: ['shareViewAggregations', shareId, query],
    queryFn: ({ queryKey }) =>
      getShareViewAggregations(queryKey[1] as string, queryKey[2] as IShareViewAggregationsRo),
    refetchOnWindowFocus: false,
  });
  const updateViewAggregations = useCallback(
    () => queryClient.invalidateQueries(['shareViewAggregations', shareId, queryRef.current]),
    [queryClient, shareId]
  );

  const viewAggregation = useMemo(() => {
    if (!shareViewAggregations) {
      return {};
    }
    const { aggregations } = shareViewAggregations.data;
    return {
      aggregations: aggregations ?? [],
    };
  }, [shareViewAggregations]);

  return (
    <AggregationContext.Provider value={viewAggregation}>{children}</AggregationContext.Provider>
  );
};
