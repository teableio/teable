import type { IViewAggregationVo } from '@teable-group/core';
import { useAggregation, useViewId } from '@teable-group/sdk/hooks';
import { isEmpty } from 'lodash';
import { useRef, useState } from 'react';
import { useUpdateEffect } from 'react-use';
import type { IColumnStatistics, IGridColumn } from '../../../grid';
import { statisticFunc2NameMap } from '../utils';

export function useColumnStatistics(columns: (IGridColumn & { id: string })[]) {
  const viewId = useViewId();
  const remoteStatistics = useAggregation();
  const [columnStatistics, setColumnStatistics] = useState<IColumnStatistics>({});
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const getColumnStatistics = (source: IViewAggregationVo | null, viewId: string) => {
    if (source == null || source[viewId] == null) return;
    const aggregations = source[viewId].aggregations;
    if (isEmpty(aggregations)) return;

    return columnsRef.current?.reduce((acc, column) => {
      const { id: columnId } = column;
      const { total, ...groups } = aggregations[columnId] || {};

      if (total != null) {
        acc[columnId] = { total: `${statisticFunc2NameMap[total.aggFunc]} ${total.value}` };
      }
      return acc;
    }, {} as IColumnStatistics);
  };

  useUpdateEffect(() => {
    if (remoteStatistics == null || viewId == null) return;

    const partialColumnStatistics = getColumnStatistics(remoteStatistics, viewId);

    if (partialColumnStatistics == null) return;

    setColumnStatistics({
      ...columnStatistics,
      ...partialColumnStatistics,
    });
  }, [remoteStatistics, viewId]);

  return { columnStatistics };
}
