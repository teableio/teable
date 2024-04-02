import { statisticFunc2NameMap } from '@teable/core';
import type { IAggregationVo } from '@teable/openapi';
import { isEmpty, keyBy } from 'lodash';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { IColumnStatistics, IGridColumn } from '../..';
import { useAggregation } from '../../../hooks/use-aggregation';
import { useFields } from '../../../hooks/use-fields';
import { useViewId } from '../../../hooks/use-view-id';
import { statisticsValue2DisplayValue } from '../../../utils';

export function useGridColumnStatistics(columns: (IGridColumn & { id: string })[]) {
  const viewId = useViewId();
  const fields = useFields({ withHidden: true });
  const remoteStatistics = useAggregation();
  const [columnStatistics, setColumnStatistics] = useState<IColumnStatistics>({});
  const columnsRef = useRef(columns);
  const fieldsRef = useRef(keyBy(fields, 'id'));
  columnsRef.current = columns;

  fieldsRef.current = useMemo(() => keyBy(fields, 'id'), [fields]);

  const getColumnStatistics = (source: IAggregationVo | null) => {
    if (source == null) return {};
    const { aggregations } = source;
    if (isEmpty(aggregations)) return {};
    const aggregationMap = keyBy(aggregations, 'fieldId');

    return columnsRef.current?.reduce((acc, column) => {
      const { id: columnId } = column;

      const columnAggregations = aggregationMap[columnId];

      const { total } = columnAggregations ?? {};

      if (columnAggregations === null || total === null) {
        acc[columnId] = null;
        return acc;
      }

      const field = fieldsRef.current[columnId];

      if (total != null && field != null) {
        const { aggFunc, value } = total;

        const displayValue = statisticsValue2DisplayValue(aggFunc, value, field);
        acc[columnId] = {
          total: `${statisticFunc2NameMap[aggFunc]} ${displayValue}`,
        };
      }
      return acc;
    }, {} as IColumnStatistics);
  };

  useEffect(() => {
    if (remoteStatistics == null || viewId == null) return;

    const partialColumnStatistics = getColumnStatistics(remoteStatistics);
    if (partialColumnStatistics == null) return;

    setColumnStatistics(partialColumnStatistics);
  }, [remoteStatistics, viewId]);

  return { columnStatistics };
}
