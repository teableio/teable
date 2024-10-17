import { NoneFunc, StatisticsFunc } from '@teable/core';
import type { IAggregationVo } from '@teable/openapi';
import { isEmpty, keyBy } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IColumnStatistics, IGridColumn } from '../..';
import { useTranslation } from '../../../context/app/i18n';
import { useAggregation } from '../../../hooks/use-aggregation';
import { useFields } from '../../../hooks/use-fields';
import { useViewId } from '../../../hooks/use-view-id';
import { statisticsValue2DisplayValue } from '../../../utils';

export const useStatisticFunc2NameMap = () => {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      [NoneFunc.None]: t('statisticFunc.none'),
      [StatisticsFunc.Count]: t('statisticFunc.count'),
      [StatisticsFunc.Empty]: t('statisticFunc.empty'),
      [StatisticsFunc.Filled]: t('statisticFunc.filled'),
      [StatisticsFunc.Unique]: t('statisticFunc.unique'),
      [StatisticsFunc.Max]: t('statisticFunc.max'),
      [StatisticsFunc.Min]: t('statisticFunc.min'),
      [StatisticsFunc.Sum]: t('statisticFunc.sum'),
      [StatisticsFunc.Average]: t('statisticFunc.average'),
      [StatisticsFunc.Checked]: t('statisticFunc.checked'),
      [StatisticsFunc.UnChecked]: t('statisticFunc.unChecked'),
      [StatisticsFunc.PercentEmpty]: t('statisticFunc.percentEmpty'),
      [StatisticsFunc.PercentFilled]: t('statisticFunc.percentFilled'),
      [StatisticsFunc.PercentUnique]: t('statisticFunc.percentUnique'),
      [StatisticsFunc.PercentChecked]: t('statisticFunc.percentChecked'),
      [StatisticsFunc.PercentUnChecked]: t('statisticFunc.percentUnChecked'),
      [StatisticsFunc.EarliestDate]: t('statisticFunc.earliestDate'),
      [StatisticsFunc.LatestDate]: t('statisticFunc.latestDate'),
      [StatisticsFunc.DateRangeOfDays]: t('statisticFunc.dateRangeOfDays'),
      [StatisticsFunc.DateRangeOfMonths]: t('statisticFunc.dateRangeOfMonths'),
      [StatisticsFunc.TotalAttachmentSize]: t('statisticFunc.totalAttachmentSize'),
    }),
    [t]
  );
};

export function useGridColumnStatistics(columns: (IGridColumn & { id: string })[]) {
  const viewId = useViewId();
  const fields = useFields({ withHidden: true, withDenied: true });
  const remoteStatistics = useAggregation();
  const [columnStatistics, setColumnStatistics] = useState<IColumnStatistics>({});
  const statisticFunc2NameMap = useStatisticFunc2NameMap();
  const getColumnStatistics = useCallback(
    (source: IAggregationVo | null) => {
      if (source == null) return {};
      const { aggregations } = source;
      if (isEmpty(aggregations)) return {};
      const aggregationMap = keyBy(aggregations, 'fieldId');
      const fieldMap = keyBy(fields, 'id');

      return columns.reduce((acc, column) => {
        const { id: columnId } = column;

        const columnAggregations = aggregationMap[columnId];

        const { total, group } = columnAggregations ?? {};

        if (columnAggregations === null || total === null) {
          acc[columnId] = null;
          return acc;
        }

        const field = fieldMap[columnId];
        const groupAggregations: Record<string, string> = {};

        if (group) {
          Object.entries(group).forEach(([groupId, item]) => {
            const { aggFunc, value } = item;
            const displayValue = statisticsValue2DisplayValue(aggFunc, value, field);
            groupAggregations[groupId] = `${statisticFunc2NameMap[aggFunc]} ${displayValue}`;
          });
        }

        if (total != null && field != null) {
          const { aggFunc, value } = total;

          const displayValue = statisticsValue2DisplayValue(aggFunc, value, field);
          acc[columnId] = {
            ...groupAggregations,
            total: `${statisticFunc2NameMap[aggFunc]} ${displayValue}`,
          };
        }
        return acc;
      }, {} as IColumnStatistics);
    },
    [columns, fields, statisticFunc2NameMap]
  );

  useEffect(() => {
    if (remoteStatistics == null || viewId == null) return;

    const partialColumnStatistics = getColumnStatistics(remoteStatistics);
    if (partialColumnStatistics == null) return;

    setColumnStatistics(partialColumnStatistics);
  }, [getColumnStatistics, remoteStatistics, viewId]);

  return { columnStatistics };
}
