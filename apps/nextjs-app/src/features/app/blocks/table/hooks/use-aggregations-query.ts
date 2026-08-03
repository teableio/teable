import type { IAggregationVo } from '@teable/openapi';
import { Table } from '@teable/sdk/model';
import { useEffect, useState } from 'react';

export const useAggregationsQuery = (tableId: string, viewId: string) => {
  const [viewAggregation, setViewAggregation] = useState<IAggregationVo>();

  useEffect(() => {
    Table.getAggregations(tableId, { viewId }).then((res) => {
      const { aggregations } = res.data;
      setViewAggregation({
        [viewId]: {
          viewId: viewId,
          aggregations: aggregations ?? [],
          executionTime: new Date().getTime(),
        },
      });
    });
  }, [tableId, viewId]);

  return viewAggregation;
};
