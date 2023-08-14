import type { IViewAggregationVo } from '@teable-group/core';
import { useAggregation, useFields, useViewId } from '@teable-group/sdk/hooks';
import { isEmpty, omit } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import type { IColumnStatistics, IGridColumn } from '../../../grid';
import { percentStatisticFuncs, statisticFunc2NameMap } from '../utils';

export const percentFormatting = (value: number) => {
  return value % 1 === 0 ? Math.round(value) : value.toFixed(2);
};

export function useColumnStatistics(columns: (IGridColumn & { id: string })[]) {
  const viewId = useViewId();
  const fields = useFields();
  const remoteStatistics = useAggregation();
  const [columnStatistics, setColumnStatistics] = useState<IColumnStatistics>({});
  const lastTimeMap = useRef<Record<string, number>>({});
  const previousViewId = useRef<string | null>(null);
  const columnsRef = useRef(columns);
  const fieldsRef = useRef(fields);
  columnsRef.current = columns;
  fieldsRef.current = fields;

  const getColumnStatistics = (source: IViewAggregationVo | null, viewId: string) => {
    if (source == null || source[viewId] == null) return;
    const { aggregations, executionTime } = source[viewId];
    if (isEmpty(aggregations)) return;

    return columnsRef.current?.reduce((acc, column, index) => {
      const { id: columnId } = column;
      const { total } = aggregations[columnId] || {};
      const field = fieldsRef.current?.[index];
      const prevExecutionTime = lastTimeMap.current[`${viewId}-${columnId}`] ?? 0;
      const isNewest = executionTime > prevExecutionTime;

      if (total != null && isNewest) {
        const { aggFunc, value } = total;

        if (value == null) {
          lastTimeMap.current[`${viewId}-${columnId}`] = executionTime;
          return omit(acc, [columnId]);
        }

        const displayValue = percentStatisticFuncs.has(aggFunc)
          ? `${percentFormatting(value as number)}%`
          : field.cellValue2String(value);
        acc[columnId] = {
          total: `${statisticFunc2NameMap[aggFunc]} ${displayValue}`,
        };

        lastTimeMap.current[`${viewId}-${columnId}`] = executionTime;
      }
      return acc;
    }, {} as IColumnStatistics);
  };

  useEffect(() => {
    if (remoteStatistics == null || viewId == null) return;

    const isDiffViewId = previousViewId.current !== viewId;
    const partialColumnStatistics = getColumnStatistics(remoteStatistics, viewId);

    if (partialColumnStatistics == null) return;

    isDiffViewId
      ? setColumnStatistics(partialColumnStatistics)
      : setColumnStatistics((prev) => ({ ...prev, ...partialColumnStatistics }));
    previousViewId.current = viewId;
  }, [remoteStatistics, viewId]);

  return { columnStatistics };
}
