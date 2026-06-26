import type { ITableActionKey, IFilter, ICollectQueryFieldIdsOptions } from '@teable/core';
import { collectQueryFieldIds, extractFieldIdsFromFilter } from '@teable/core';
import { useCallback, useContext, useMemo } from 'react';
import { TablePermissionContext } from '../context/table-permission';
import { useTableListener } from './use-table-listener';

interface IRelevantFieldIdsOptions extends Omit<ICollectQueryFieldIdsOptions, 'filter'> {
  queryFilter?: IFilter;
  viewFilter?: IFilter;
}

export const collectRelevantFieldIds = (options: IRelevantFieldIdsOptions): Set<string> | null => {
  const { queryFilter, viewFilter, ...rest } = options;

  const ids = collectQueryFieldIds({ ...rest, filter: queryFilter });
  if (!ids) return null;

  if (viewFilter) {
    const viewIds = collectQueryFieldIds({ filter: viewFilter });
    if (viewIds) {
      for (const fid of viewIds) {
        ids.add(fid);
      }
    }
  }

  return ids;
};

export const useFieldAwareTableListener = (
  tableId: string | undefined,
  matches: ITableActionKey[],
  relevantFieldIds: Set<string> | null,
  callback: () => void
) => {
  // the server additionally filters rows by the user's authority-matrix read
  // filter; edits to its referenced fields can move rows in or out of any
  // query result, so they are always relevant
  const { recordReadFilter } = useContext(TablePermissionContext);
  const effectiveFieldIds = useMemo(() => {
    if (!relevantFieldIds || !recordReadFilter) {
      return relevantFieldIds;
    }
    const merged = new Set(relevantFieldIds);
    for (const fid of extractFieldIdsFromFilter(recordReadFilter, true)) {
      merged.add(fid);
    }
    return merged;
  }, [relevantFieldIds, recordReadFilter]);

  const handler = useCallback(
    (actionKey: string, payload?: Record<string, unknown>) => {
      if (actionKey === 'setRecord' && effectiveFieldIds) {
        const fieldIds = payload?.fieldIds as string[] | undefined;
        // fieldIds is the set of changed cell values: an explicit empty array
        // (e.g. row reorder) or no overlap with the relevant fields cannot
        // change this query's result; only a missing payload refreshes
        // conservatively
        if (Array.isArray(fieldIds) && !fieldIds.some((fid) => effectiveFieldIds.has(fid))) {
          return;
        }
      }
      callback();
    },
    [callback, effectiveFieldIds]
  );

  return useTableListener(tableId, matches, handler);
};
