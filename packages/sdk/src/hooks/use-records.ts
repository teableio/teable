import type { IFilter, IRecord, ISort } from '@teable/core';
import {
  IdPrefix,
  mergeWithDefaultFilter,
  mergeWithDefaultSort,
  stripSortByReadableFieldIds,
} from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { keyBy } from 'lodash';
import { useCallback, useContext, useMemo } from 'react';
import type { Doc } from 'sharedb/lib/client';
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
  const allFields = useFields({ withHidden: true, withDenied: true });

  // Fields whose records the current user may return; undefined until fields
  // load. Saved filters must remain in the subscription because the server
  // evaluates response-hidden authority fields through masks and skipPoll must
  // keep every filter dependency. Saved sorts still drop fields unavailable
  // to the client; explicit query sort/filter remains server-authoritative.
  // canReadFieldRecord === undefined means no authority-matrix restriction.
  const readableFieldIds = useMemo(
    () =>
      allFields.length
        ? new Set(
            allFields.filter((field) => field.canReadFieldRecord !== false).map(({ id }) => id)
          )
        : undefined,
    [allFields]
  );

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
    const inlinedViewSort = stripSortByReadableFieldIds(viewSort, readableFieldIds);
    const inlinedShareViewSort = stripSortByReadableFieldIds(shareViewSort, readableFieldIds);
    return {
      ...base,
      ignoreViewQuery: true,
      filter: mergeWithDefaultFilter(
        shareViewFilter ? JSON.stringify(shareViewFilter) : undefined,
        mergeWithDefaultFilter(viewFilter ? JSON.stringify(viewFilter) : undefined, query?.filter)
      ),
      orderBy: mergeWithDefaultSort(
        inlinedShareViewSort ? JSON.stringify(inlinedShareViewSort) : undefined,
        mergeWithDefaultSort(
          inlinedViewSort ? JSON.stringify(inlinedViewSort) : undefined,
          query?.orderBy
        )
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
    readableFieldIds,
  ]);
  const factory = useCallback(
    (record: IRecord, doc?: Doc<IRecord>) => {
      const instance = createRecordInstance(record, doc);
      if (!doc) {
        // doc-less (seeded) instance: stash the table id so cell edits can
        // still resolve their REST endpoint before the subscription doc arrives
        instance.tableId = tableId;
      }
      return instance;
    },
    [tableId]
  );

  const { instances, extra } = useInstances({
    collection: `${IdPrefix.Record}_${tableId}`,
    factory,
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
