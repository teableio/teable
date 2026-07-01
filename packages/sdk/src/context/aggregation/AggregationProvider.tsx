import { useQueryClient } from '@tanstack/react-query';
import type { IFilter, IGridColumnMeta, ITableActionKey, IViewActionKey } from '@teable/core';
import type { IAggregationRo, IQueryBaseRo } from '@teable/openapi';
import { getAggregation, getShareViewAggregations } from '@teable/openapi';
import { throttle } from 'lodash';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useSearch, useServerViewFilter, useView, useViewListener } from '../../hooks';
import { useDocumentVisible } from '../../hooks/use-document-visible';
import {
  collectRelevantFieldIds,
  useFieldAwareTableListener,
} from '../../hooks/use-field-aware-table-listener';
import { buildStatisticFieldMap } from '../../utils';
import { AnchorContext } from '../anchor';
import { ShareViewContext } from '../table/ShareViewContext';
import { AggregationContext } from './AggregationContext';
import { useShareAwareQuery } from './use-share-aware-query';

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
  const { shareId, fields: shareFields } = useContext(ShareViewContext);
  const view = useView(viewId);
  const queryClient = useQueryClient();
  const { filteringSearchQuery } = useSearch();
  const visible = useDocumentVisible();
  const { group } = view || {};

  // the share endpoint resolves the stored view through shareId; the visitor's
  // local filter and statistic funcs only exist on the proxied view and must
  // travel with the query. Hidden columns are dropped (ShareViewContext.fields
  // is already hidden-filtered server side) so their aggregates are never
  // requested for — nor leaked to — the share visitor
  const shareFieldStats = useMemo(() => {
    if (!shareId) return undefined;
    const fieldMap = buildStatisticFieldMap(
      view?.columnMeta as IGridColumnMeta | undefined,
      shareFields?.map(({ id }) => id)
    );
    return Object.keys(fieldMap).length ? (fieldMap as IAggregationRo['field']) : undefined;
  }, [shareId, view?.columnMeta, shareFields]);

  const groupKey = JSON.stringify(group);
  const aggQuery = useMemo(
    () => {
      const shareQuery = shareId ? { filter: view?.filter, field: shareFieldStats } : undefined;
      return {
        viewId,
        search: filteringSearchQuery,
        groupBy: group,
        ...shareQuery,
        ...query,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteringSearchQuery, viewId, query, groupKey, shareId, view?.filter, shareFieldStats]
  );
  const ignoreViewQuery = aggQuery?.ignoreViewQuery ?? false;

  // Use different query keys for common and share queries to avoid conflicts
  const commonQueryKey = useMemo(
    () => ReactQueryKeys.aggregations(tableId as string, aggQuery),
    [tableId, aggQuery]
  );
  const shareQueryKey = useMemo(
    () => ReactQueryKeys.shareViewAggregations(shareId as string, aggQuery),
    [shareId, aggQuery]
  );

  const { data: resAggregations, activeQueryKey } = useShareAwareQuery({
    shareId,
    enabled: Boolean(tableId && visible),
    common: {
      queryKey: commonQueryKey,
      queryFn: () => getAggregation(tableId as string, aggQuery).then((data) => data.data),
    },
    share: {
      queryKey: shareQueryKey,
      queryFn: () =>
        getShareViewAggregations(shareId as string, aggQuery).then((data) => data.data),
    },
  });

  const updateAggregations = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: activeQueryKey.slice(0, 3),
      }),
    [queryClient, activeQueryKey]
  );

  const throttleUpdateAggregations = useMemo(() => {
    return throttle(updateAggregations, THROTTLE_TIME);
  }, [updateAggregations]);

  const updateAggregationsForTable = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: activeQueryKey.slice(0, 2),
      }),
    [queryClient, activeQueryKey]
  );

  const throttleUpdateAggregationsForTable = useMemo(() => {
    return throttle(updateAggregationsForTable, THROTTLE_TIME);
  }, [updateAggregationsForTable]);

  const serverViewFilter = useServerViewFilter();

  // aggregation values depend on which rows pass the filters/search, not just
  // on the aggregated fields themselves. Statistic fields come from the shared
  // view's columnMeta or, for personal views, from the query's own field map
  const relevantFieldIds = useMemo(
    () =>
      collectRelevantFieldIds({
        queryFilter: aggQuery.filter as IFilter | undefined,
        viewFilter: serverViewFilter,
        search: aggQuery.search,
        groupBy: aggQuery.groupBy,
        extraFieldIds: [
          ...getAggregatedFieldIds(view?.columnMeta as IGridColumnMeta | undefined),
          ...Object.values(aggQuery.field ?? {}).flat(),
        ],
      }),
    [aggQuery, serverViewFilter, view?.columnMeta]
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
