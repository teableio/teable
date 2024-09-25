import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IGridColumnMeta, ITableActionKey, IViewActionKey } from '@teable/core';
import type { IAggregationRo, IShareViewAggregationsRo } from '@teable/openapi';
import { getShareViewAggregations } from '@teable/openapi';
import {
  useView,
  ReactQueryKeys,
  AggregationContext,
  useSearch,
  useViewListener,
  useTableListener,
  ShareViewContext,
} from '@teable/sdk';
import type { ReactNode } from 'react';
import { useCallback, useContext, useMemo, useRef } from 'react';

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
    () => ({ filter: view?.filter, field, search: searchQuery, groupBy: view?.group }),
    [field, searchQuery, view?.filter, view?.group]
  );
};

export const AggregationProvider = ({ children }: IAggregationProviderProps) => {
  const { tableId, shareId } = useContext(ShareViewContext);
  const queryClient = useQueryClient();
  const query = useAggregationQuery();
  const queryRef = useRef(query);
  queryRef.current = query;

  const { data: shareViewAggregations } = useQuery({
    queryKey: ReactQueryKeys.shareViewAggregations(shareId, query),
    queryFn: ({ queryKey }) =>
      getShareViewAggregations(queryKey[1], queryKey[2]).then((data) => data.data),
    refetchOnWindowFocus: false,
  });

  const updateViewAggregations = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.shareViewAggregations(shareId, query)),
    [query, queryClient, shareId]
  );

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['setRecord', 'addRecord', 'deleteRecord'],
    []
  );
  useTableListener(tableId, tableMatches, updateViewAggregations);

  const viewMatches = useMemo<IViewActionKey[]>(
    () => ['applyViewFilter', 'showViewField', 'applyViewStatisticFunc'],
    []
  );
  useViewListener(tableId, viewMatches, updateViewAggregations);

  const viewAggregation = useMemo(() => {
    if (!shareViewAggregations) {
      return {};
    }
    const { aggregations } = shareViewAggregations;
    return {
      aggregations: aggregations ?? [],
    };
  }, [shareViewAggregations]);

  return (
    <AggregationContext.Provider value={viewAggregation}>{children}</AggregationContext.Provider>
  );
};
