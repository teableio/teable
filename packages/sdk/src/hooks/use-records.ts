import type { IRecord } from '@teable/core';
import { IdPrefix } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { keyBy } from 'lodash';
import { useMemo } from 'react';
import { useInstances } from '../context/use-instances';
import { createRecordInstance, recordInstanceFieldMap } from '../model';
import { useFields } from './use-fields';
import { useSearch } from './use-search';
import { useTableId } from './use-table-id';
import { useViewId } from './use-view-id';

export const useRecords = (query?: IGetRecordsRo, initData?: IRecord[]) => {
  const tableId = useTableId();

  const viewId = useViewId();

  const fields = useFields();

  const { searchQuery } = useSearch();

  const queryParams = useMemo(() => {
    return {
      viewId,
      search: searchQuery,
      ...query,
      type: IdPrefix.Record,
    };
  }, [query, searchQuery, viewId]);

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
