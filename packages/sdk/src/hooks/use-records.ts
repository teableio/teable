import type { IFilter, IRecord, ISort } from '@teable/core';
import { IdPrefix, mergeWithDefaultFilter, mergeWithDefaultSort } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { keyBy } from 'lodash';
import { useContext, useMemo } from 'react';
import { ShareViewContext } from '../context/table/ShareViewContext';
import { TablePermissionContext } from '../context/table-permission';
import { useInstances } from '../context/use-instances';
import { createRecordInstance, recordInstanceFieldMap } from '../model';
import { useDeepCompareMemoize } from './use-deep-compare-memoize';
import { useFields } from './use-fields';
import { useSearch } from './use-search';
import { useTableId } from './use-table-id';
import { useView } from './use-view';
import { useViewId } from './use-view-id';

export const useRecords = (query?: IGetRecordsRo, initData?: IRecord[]) => {
  const tableId = useTableId();

  const viewId = useViewId();

  const fields = useFields();

  const { filteringSearchQuery } = useSearch();

  const { recordReadFilter } = useContext(TablePermissionContext);
  const view = useView();

  // visible (and readable) field ids; sorted so the subscription identity is
  // insensitive to column order changes
  const visibleFieldIds = useDeepCompareMemoize(fields.map((field) => field.id).sort()) as string[];

  // the subscription identity must follow the condition content, not the view
  // instance identity, which changes on every view op
  const viewFilter = useDeepCompareMemoize(view?.filter ?? null) as IFilter | null;
  const viewSort = useDeepCompareMemoize(view?.sort ?? null) as ISort | null;

  // in share the proxied view carries only the visitor's local filter/sort
  // (ShareViewProxy nulls the stored ones), yet the shared view's stored
  // conditions still constrain the server result — inline them too, so the
  // query semantics and the server-side skipPoll field analysis stay correct
  const { view: shareServerView } = useContext(ShareViewContext);
  const shareView = shareServerView?.id === viewId ? shareServerView : undefined;
  const shareViewFilter = useDeepCompareMemoize(shareView?.filter ?? null) as IFilter | null;
  const shareViewSort = useDeepCompareMemoize(shareView?.sort ?? null) as ISort | null;

  const queryParams = useMemo(() => {
    const base = {
      search: filteringSearchQuery,
      // advisory copy of the user's authority-matrix read filter: row
      // visibility depends on it, so the server-side skipPoll must treat its
      // referenced fields as relevant to this subscription
      recordReadFilter,
      viewId,
      ...query,
      type: IdPrefix.Record,
    };
    if (query?.ignoreViewQuery) {
      return base;
    }
    // inline the view filter/sort (the same merge the server applies to a
    // plain viewId query) and set ignoreViewQuery, so the server-side skipPoll
    // can tell which fields the subscription depends on. viewId still rides
    // along: the server reads it for the view's manual row order, permission
    // wrapping and hidden-field exclusion, which cannot be inlined
    return {
      ...base,
      ignoreViewQuery: true,
      filter: mergeWithDefaultFilter(
        shareViewFilter ? JSON.stringify(shareViewFilter) : undefined,
        mergeWithDefaultFilter(viewFilter ? JSON.stringify(viewFilter) : undefined, query?.filter)
      ),
      orderBy: mergeWithDefaultSort(
        shareViewSort ? JSON.stringify(shareViewSort) : undefined,
        mergeWithDefaultSort(viewSort ? JSON.stringify(viewSort) : undefined, query?.orderBy)
      ),
      // search must only hit the fields displayed in this view, the same
      // contract the personal-view query expresses with its own projection
      projection: query?.projection ?? visibleFieldIds,
    };
  }, [
    query,
    filteringSearchQuery,
    recordReadFilter,
    viewId,
    viewFilter,
    viewSort,
    shareViewFilter,
    shareViewSort,
    visibleFieldIds,
  ]);
  const { instances, extra } = useInstances({
    collection: `${IdPrefix.Record}_${tableId}`,
    factory: createRecordInstance,
    queryParams,
    initData,
  });
  return useMemo(() => {
    const fieldMap = keyBy(fields, 'id');
    return {
      records: instances.map((instance) => recordInstanceFieldMap(instance, fieldMap)),
      extra,
    };
  }, [instances, fields, extra]);
};
