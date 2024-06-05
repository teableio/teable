import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IGridColumnMeta, ITableActionKey, IViewActionKey } from '@teable/core';
import type { IAggregationRo, IShareViewAggregationsRo } from '@teable/openapi';
import { getShareViewAggregations } from '@teable/openapi';
import { useView, ReactQueryKeys, AggregationContext, useSearch } from '@teable/sdk';
import { useActionPresence } from '@teable/sdk/hooks/use-presence';
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
  const tablePresence = useActionPresence(tableId);
  const viewPresence = useActionPresence(viewId);
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
    if (tableId == null || !tablePresence) return;

    const relevantProps = new Set<ITableActionKey>(['setRecord', 'addRecord', 'deleteRecord']);
    const cb = (_id: string, res: ITableActionKey[]) =>
      res.some((action) => relevantProps.has(action)) && updateViewAggregations();

    tablePresence.addListener('receive', cb);

    return () => {
      tablePresence.removeListener('receive', cb);
    };
  }, [tablePresence, tableId, updateViewAggregations]);

  useEffect(() => {
    if (viewId == null || !viewPresence) return;

    const relevantProps = new Set<IViewActionKey>([
      'applyViewFilter',
      'showViewField',
      'applyViewStatisticFunc',
    ]);

    const cb = (_id: string, res: IViewActionKey[]) =>
      res.some((action) => relevantProps.has(action)) && updateViewAggregations();

    viewPresence.addListener('receive', cb);

    return () => {
      viewPresence.removeListener('receive', cb);
    };
  }, [viewPresence, viewId, updateViewAggregations]);

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
