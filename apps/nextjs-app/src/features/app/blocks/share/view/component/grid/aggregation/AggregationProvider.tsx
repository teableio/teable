import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IGridColumnMeta } from '@teable/core';
import type { IAggregationRo, IShareViewAggregationsRo } from '@teable/openapi';
import { getShareViewAggregations } from '@teable/openapi';
import type { PropKeys } from '@teable/sdk';
import {
  useView,
  ReactQueryKeys,
  AggregationContext,
  useActionTrigger,
  useSearch,
} from '@teable/sdk';
import type { ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { ShareViewPageContext } from '../../../ShareViewPageContext';

interface IAggregationProviderProps {
  children: ReactNode;
}

const useAggregationQuery = (): IShareViewAggregationsRo => {
  const view = useView();
  const { searchQuery } = useSearch();

  const field = useMemo(
    () =>
      view?.columnMeta &&
      Object.entries(view.columnMeta as IGridColumnMeta).reduce<Partial<IAggregationRo['field']>>(
        (acc, [fieldId, { statisticFunc }]) => {
          if (statisticFunc && acc) {
            const existingArr = acc[statisticFunc] || [];
            acc[statisticFunc] = [...existingArr, fieldId];
          }
          return acc;
        },
        {}
      ),
    [view?.columnMeta]
  );
  return useMemo(
    () => ({ filter: view?.filter, field, search: searchQuery }),
    [field, searchQuery, view?.filter]
  );
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
    const relevantProps: PropKeys[] = [
      'addRecord',
      'setRecord',
      'deleteRecord',
      'applyViewFilter',
      'showViewField',
      'applyViewStatisticFunc',
    ];

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
