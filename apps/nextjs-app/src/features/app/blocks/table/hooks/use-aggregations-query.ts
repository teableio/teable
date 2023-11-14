import type { IRawAggregationVo } from '@teable-group/core';
import { View } from '@teable-group/sdk/model';
import { useEffect, useState } from 'react';

export const useAggregationsQuery = (tableId: string, viewId: string) => {
  const [viewAggregation, setViewAggregation] = useState<IRawAggregationVo>();

  useEffect(() => {
    View.getViewAggregations(tableId, viewId).then((res) => {
      const { viewId, aggregations } = res.data;
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
