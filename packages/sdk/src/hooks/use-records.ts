import { IdPrefix } from '@teable-group/core';
import { keyBy } from 'lodash';
import { useMemo } from 'react';
import { useInstances } from '../context/use-instances';
import { createRecordInstance, recordInstanceFieldMap } from '../model';
import { useFields } from './use-fields';
import { useTableId } from './use-table-id';
import { useViewId } from './use-view-id';

interface IQuery {
  offset?: number;
  limit?: number;
}

export const useRecords = (query?: IQuery) => {
  const tableId = useTableId();

  const viewId = useViewId();

  const fields = useFields();

  const { offset = 0, limit = 50 } = query || {};

  const instances = useInstances({
    collection: `${IdPrefix.Record}_${tableId}`,
    factory: createRecordInstance,
    queryParams: {
      viewId,
      offset,
      limit,
    },
  });
  return useMemo(() => {
    const fieldMap = keyBy(fields, 'id');
    return instances.map((instance) => recordInstanceFieldMap(instance, fieldMap));
  }, [instances, fields]);
};
