import type { IAggregationVo } from '@teable-group/core';
import { statisticFunc2NameMap } from '@teable-group/core';
import { isEmpty, keyBy } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import type { IColumnStatistics, IGridColumn } from '../..';
import { useAggregation } from '../../../hooks/use-aggregation';
import { useFields } from '../../../hooks/use-fields';
import { useViewId } from '../../../hooks/use-view-id';
import { statisticsValue2DisplayValue } from '../../../utils';

export function useGridColumnStatistics(columns: (IGridColumn & { id: string })[]) {
  const viewId = useViewId();
  const fields = useFields();
  const remoteStatistics = useAggregation();
  const [columnStatistics, setColumnStatistics] = useState<IColumnStatistics>({});
  // const lastTimeMap = useRef<Record<string, number>>({});
  const previousViewId = useRef<string | null>(null);
  const columnsRef = useRef(columns);
  const fieldsRef = useRef(fields);
  columnsRef.current = columns;
  fieldsRef.current = fields;

  const getColumnStatistics = (source: IAggregationVo | null) => {
    if (source == null) return {};
    const { aggregations } = source;
    if (isEmpty(aggregations)) return {};
    const aggregationMap = keyBy(aggregations, 'fieldId');

    return columnsRef.current?.reduce((acc, column, index) => {
      const { id: columnId } = column;

      const columnAggregations = aggregationMap[columnId];
      // const prevExecutionTime = lastTimeMap.current[`${viewId}-${columnId}`] ?? 0;
      // const isNewest = executionTime > prevExecutionTime;

      const { total } = columnAggregations ?? {};

      // if ((columnAggregations === null || total === null) && isNewest) {
      if (columnAggregations === null || total === null) {
        acc[columnId] = null;
        // lastTimeMap.current[`${viewId}-${columnId}`] = executionTime;
        return acc;
      }

      const field = fieldsRef.current?.[index];

      // if (total != null && isNewest) {
      if (total != null) {
        const { aggFunc, value } = total;

        const displayValue = statisticsValue2DisplayValue(aggFunc, value, field);
        acc[columnId] = {
          total: `${statisticFunc2NameMap[aggFunc]} ${displayValue}`,
        };

        // lastTimeMap.current[`${viewId}-${columnId}`] = executionTime;
      }
      return acc;
    }, {} as IColumnStatistics);
  };

  useEffect(() => {
    if (remoteStatistics == null || viewId == null) return;
    const isDiffViewId = previousViewId.current !== viewId;
    const partialColumnStatistics = getColumnStatistics(remoteStatistics);

    if (partialColumnStatistics == null) return;

    isDiffViewId
      ? setColumnStatistics(partialColumnStatistics)
      : setColumnStatistics((prev) => ({ ...prev, ...partialColumnStatistics }));
    previousViewId.current = viewId;
  }, [remoteStatistics, viewId]);

  return { columnStatistics };
}
