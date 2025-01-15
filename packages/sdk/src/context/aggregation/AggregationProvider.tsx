import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ITableActionKey, IViewActionKey } from '@teable/core';
import type { IQueryBaseRo } from '@teable/openapi';
import { getAggregation } from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useSearch, useTableListener, useView, useViewListener } from '../../hooks';
import { AnchorContext } from '../anchor';
import { AggregationContext } from './AggregationContext';

interface IAggregationProviderProps {
  children: ReactNode;
  query?: IQueryBaseRo;
}

export const AggregationProvider: FC<IAggregationProviderProps> = ({ children, query }) => {
  const { tableId, viewId } = useContext(AnchorContext);
  const view = useView(viewId);
  const queryClient = useQueryClient();
  const { searchQuery } = useSearch();
  const { group } = view || {};

  const aggQuery = useMemo(
    () => {
      return {
        viewId,
        search: searchQuery,
        groupBy: group,
        ...query,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchQuery, viewId, query, JSON.stringify(group)]
  );
  const ignoreViewQuery = aggQuery?.ignoreViewQuery ?? false;
  const { data: resAggregations } = useQuery({
    queryKey: ReactQueryKeys.aggregations(tableId as string, aggQuery),
    queryFn: ({ queryKey }) => getAggregation(queryKey[1], queryKey[2]).then((data) => data.data),
    enabled: !!tableId,
    refetchOnWindowFocus: false,
  });

  const updateAggregations = useCallback(
    (cleanAll?: boolean) =>
      queryClient.invalidateQueries(
        ReactQueryKeys.aggregations(tableId as string, aggQuery).slice(0, cleanAll ? 2 : 3)
      ),
    [aggQuery, queryClient, tableId]
  );

  const updateAggregationsForTable = useCallback(
    () => updateAggregations(true),
    [updateAggregations]
  );

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['setRecord', 'addRecord', 'deleteRecord'],
    []
  );
  useTableListener(tableId, tableMatches, updateAggregationsForTable);

  const viewMatches = useMemo<IViewActionKey[]>(
    () => (ignoreViewQuery ? [] : ['applyViewFilter', 'showViewField', 'applyViewStatisticFunc']),
    [ignoreViewQuery]
  );
  useViewListener(viewId, viewMatches, updateAggregations);

  const aggregations = useMemo(() => {
    if (!resAggregations) return {};

    const { aggregations } = resAggregations;
    return {
      aggregations: aggregations ?? [],
    };
  }, [resAggregations]);
  return <AggregationContext.Provider value={aggregations}>{children}</AggregationContext.Provider>;
};
