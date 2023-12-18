import type { IAggregationVo } from '@teable-group/core';
import { Table } from '@teable-group/sdk/model';
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
