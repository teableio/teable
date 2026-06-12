import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IFilter, IGridColumnMeta, ITableActionKey, IViewActionKey } from '@teable/core';
import type { IAggregationRo, IQueryBaseRo } from '@teable/openapi';
import { getAggregation } from '@teable/openapi';
import { throttle } from 'lodash';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useSearch, useView, useViewListener } from '../../hooks';
import { useDocumentVisible } from '../../hooks/use-document-visible';
import {
  collectRelevantFieldIds,
  useFieldAwareTableListener,
} from '../../hooks/use-field-aware-table-listener';
import { AnchorContext } from '../anchor';
import { AggregationContext } from './AggregationContext';

interface IAggregationProviderProps {
  children: ReactNode;
  query?: IQueryBaseRo & Pick<IAggregationRo, 'field'>;
}

const THROTTLE_TIME = 2000;

const getAggregatedFieldIds = (columnMeta: IGridColumnMeta | undefined): string[] => {
  if (!columnMeta) return [];
  return Object.entries(columnMeta)
    .filter(([, meta]) => meta.statisticFunc)
    .map(([fieldId]) => fieldId);
};

export const AggregationProvider: FC<IAggregationProviderProps> = ({ children, query }) => {
  const { tableId, viewId } = useContext(AnchorContext);
  const view = useView(viewId);
  const queryClient = useQueryClient();
  const { filteringSearchQuery } = useSearch();
  const visible = useDocumentVisible();
  const { group } = view || {};

  const aggQuery = useMemo(
    () => {
      return {
        viewId,
        search: filteringSearchQuery,
        groupBy: group,
        ...query,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteringSearchQuery, viewId, query, JSON.stringify(group)]
  );
  const ignoreViewQuery = aggQuery?.ignoreViewQuery ?? false;
  const { data: resAggregations } = useQuery({
    queryKey: ReactQueryKeys.aggregations(tableId as string, aggQuery),
    queryFn: ({ queryKey }) => getAggregation(queryKey[1], queryKey[2]).then((data) => data.data),
    enabled: !!tableId && visible,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const updateAggregations = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.aggregations(tableId as string, aggQuery).slice(0, 3),
      }),
    [aggQuery, queryClient, tableId]
  );

  const throttleUpdateAggregations = useMemo(() => {
    return throttle(updateAggregations, THROTTLE_TIME);
  }, [updateAggregations]);

  const updateAggregationsForTable = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.aggregations(tableId as string, aggQuery).slice(0, 2),
      }),
    [aggQuery, queryClient, tableId]
  );

  const throttleUpdateAggregationsForTable = useMemo(() => {
    return throttle(updateAggregationsForTable, THROTTLE_TIME);
  }, [updateAggregationsForTable]);

  // aggregation values depend on which rows pass the filters/search, not just
  // on the aggregated fields themselves. Statistic fields come from the shared
  // view's columnMeta or, for personal views, from the query's own field map
  const relevantFieldIds = useMemo(
    () =>
      collectRelevantFieldIds({
        queryFilter: aggQuery.filter as IFilter | undefined,
        viewFilter: ignoreViewQuery ? undefined : (view?.filter as IFilter | undefined),
        search: aggQuery.search,
        groupBy: aggQuery.groupBy,
        extraFieldIds: [
          ...getAggregatedFieldIds(view?.columnMeta as IGridColumnMeta | undefined),
          ...Object.values(aggQuery.field ?? {}).flat(),
        ],
      }),
    [aggQuery, ignoreViewQuery, view?.filter, view?.columnMeta]
  );

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['setRecord', 'addRecord', 'deleteRecord'],
    []
  );
  useFieldAwareTableListener(
    tableId,
    tableMatches,
    relevantFieldIds,
    throttleUpdateAggregationsForTable
  );

  const viewMatches = useMemo<IViewActionKey[]>(
    () => (ignoreViewQuery ? [] : ['applyViewFilter', 'showViewField', 'applyViewStatisticFunc']),
    [ignoreViewQuery]
  );
  useViewListener(viewId, viewMatches, throttleUpdateAggregations);

  const aggregations = useMemo(() => {
    if (!resAggregations) return {};

    const { aggregations } = resAggregations;
    return {
      aggregations: aggregations ?? [],
    };
  }, [resAggregations]);
  return <AggregationContext.Provider value={aggregations}>{children}</AggregationContext.Provider>;
};
