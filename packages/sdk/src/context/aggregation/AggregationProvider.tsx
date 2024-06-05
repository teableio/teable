import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ITableActionKey, IViewActionKey } from '@teable/core';
import { getAggregation } from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useSearch } from '../../hooks';
import { useActionPresence } from '../../hooks/use-presence';
import { AnchorContext } from '../anchor';
import { AggregationContext } from './AggregationContext';

interface IAggregationProviderProps {
  children: ReactNode;
}

export const AggregationProvider: FC<IAggregationProviderProps> = ({ children }) => {
  const { tableId, viewId } = useContext(AnchorContext);
  const tablePresence = useActionPresence(tableId);
  const viewPresence = useActionPresence(viewId);
  const queryClient = useQueryClient();
  const { searchQuery } = useSearch();
  const aggQuery = useMemo(() => ({ viewId, search: searchQuery }), [searchQuery, viewId]);
  const { data: resAggregations } = useQuery({
    queryKey: ReactQueryKeys.aggregations(tableId as string, aggQuery),
    queryFn: ({ queryKey }) => getAggregation(queryKey[1], queryKey[2]),
    enabled: !!tableId,
    refetchOnWindowFocus: false,
  });

  const updateAggregations = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.aggregations(tableId as string, aggQuery)),
    [aggQuery, queryClient, tableId]
  );

  useEffect(() => {
    if (tableId == null || !tablePresence) return;

    const relevantProps = new Set<ITableActionKey>(['setRecord', 'addRecord', 'deleteRecord']);
    const cb = (_id: string, res: ITableActionKey[]) =>
      res.some((action) => relevantProps.has(action)) && updateAggregations();

    tablePresence.addListener('receive', cb);

    return () => {
      tablePresence.removeListener('receive', cb);
    };
  }, [tablePresence, tableId, updateAggregations]);

  useEffect(() => {
    if (viewId == null || !viewPresence) return;

    const relevantProps = new Set<IViewActionKey>([
      'applyViewFilter',
      'showViewField',
      'applyViewStatisticFunc',
    ]);

    const cb = (_id: string, res: IViewActionKey[]) => {
      console.log(
        'updateAggregations',
        res.some((action) => relevantProps.has(action))
      );
      res.some((action) => relevantProps.has(action)) && updateAggregations();
    };

    viewPresence.addListener('receive', cb);

    return () => {
      viewPresence.removeListener('receive', cb);
    };
  }, [viewPresence, viewId, updateAggregations]);

  const aggregations = useMemo(() => {
    if (!resAggregations) return {};

    const { aggregations } = resAggregations.data;
    return {
      aggregations: aggregations ?? [],
    };
  }, [resAggregations]);
  return <AggregationContext.Provider value={aggregations}>{children}</AggregationContext.Provider>;
};
