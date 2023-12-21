import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IShareViewAggregationsRo } from '@teable-group/openapi';
import { getShareViewAggregations } from '@teable-group/openapi';
import type { PropKeys } from '@teable-group/sdk';
import { useView, ReactQueryKeys, AggregationContext, useActionTrigger } from '@teable-group/sdk';
import type { ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { ShareViewPageContext } from '../../../ShareViewPageContext';

interface IAggregationProviderProps {
  children: ReactNode;
}

const useAggregationQuery = (): IShareViewAggregationsRo => {
  const view = useView();
  return useMemo(() => ({ filter: view?.filter }), [view?.filter]);
};

export const AggregationProvider = ({ children }: IAggregationProviderProps) => {
  const { tableId, viewId, shareId } = useContext(ShareViewPageContext);
  const { listener } = useActionTrigger();
  const queryClient = useQueryClient();
  const query = useAggregationQuery();
  const queryRef = useRef(query);
  queryRef.current = query;

  const { data: shareViewAggregations } = useQuery({
    queryKey: ReactQueryKeys.shareViewAggregations(shareId, query),
    queryFn: ({ queryKey }) => getShareViewAggregations(queryKey[1], queryKey[2]),
    refetchOnWindowFocus: false,
  });

  const updateViewAggregations = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.shareViewAggregations(shareId, query)),
    [query, queryClient, shareId]
  );

  useEffect(() => {
    const relevantProps = [
      'tableAdd',
      'tableUpdate',
      'tableDelete',
      'applyViewFilter',
      'showViewField',
    ] as PropKeys[];

    listener?.(relevantProps, () => updateViewAggregations(), [tableId, viewId]);
  }, [listener, tableId, updateViewAggregations, viewId]);

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
