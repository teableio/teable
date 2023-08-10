import type { IViewAggregateVo, StatisticsFunc } from '@teable-group/core';
import { useAggregate, useTableId, useViewId } from '@teable-group/sdk/hooks';
import { View } from '@teable-group/sdk/model';
import { isEmpty } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import { useUpdateEffect } from 'react-use';
import type { IGridColumn, IColumnStatistics } from '../../../grid';
import { statisticFunc2NameMap } from '../utils';

export function useColumnStatistics(columns: (IGridColumn & { id: string })[]) {
  const viewId = useViewId();
  const tableId = useTableId();
  const remoteStatistics = useAggregate();
  const [columnStatistics, setColumnStatistics] = useState<IColumnStatistics>({});
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const getColumnStatistics = (source: IViewAggregateVo | null, viewId: string) => {
    if (source == null || source[viewId] == null) return;
    const aggregates = source[viewId].aggregates;
    if (isEmpty(aggregates)) return;

    return columnsRef.current?.reduce((acc, column) => {
      const { id: columnId } = column;
      const { value, funcName } = aggregates[columnId] || {};

      if (value != null) {
        acc[columnId] = { total: `${statisticFunc2NameMap[funcName as StatisticsFunc]} ${value}` };
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

  useEffect(() => {
    if (tableId == null || viewId == null) return;

    View.getViewAggregate(tableId, viewId).then((res) => {
      const newColumnStatistics = getColumnStatistics(res, viewId);
      if (newColumnStatistics == null) {
        return setColumnStatistics({});
      }
      setColumnStatistics(newColumnStatistics);
    });
  }, [tableId, viewId]);

  return { columnStatistics };
}
