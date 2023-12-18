import type { StatisticsFunc } from '@teable-group/core';
import { CellValueType } from '@teable-group/core';
import { useFields, useTable, useViewId } from '@teable-group/sdk/hooks';
import { Table } from '@teable-group/sdk/model';
import { statisticsValue2DisplayValue } from '@teable-group/sdk/utils';
import { useEffect, useMemo, useState } from 'react';

export function useAggregates(funcs: StatisticsFunc[]) {
  const fields = useFields();
  const table = useTable();
  const [aggregates, setAggregates] = useState<
    ({ value: string | null; name: string; func: string } | null)[]
  >([]);
  const viewId = useViewId();
  const sortedFields = useMemo(
    () => fields.filter((field) => field.cellValueType === CellValueType.Number),
    [fields]
  );

  useEffect(() => {
    if (!sortedFields.length || sortedFields[0].tableId !== table?.id) {
      return;
    }

    const statsList = funcs.reduce(
      (pre, cur, i) => {
        const field = sortedFields[i];
        if (!field || !table?.id || !viewId) {
          return pre;
        }
        (pre[cur] = pre[cur] ?? []).push(field.id);
        return pre;
      },
      {} as { [func in StatisticsFunc]: string[] }
    );

    if (!table?.id || !viewId || !Object.keys(statsList)?.length) {
      return;
    }

    Table.getAggregations(table.id, {
      viewId,
      field: statsList,
    }).then(({ data: { aggregations } }) => {
      if (!aggregations) {
        return;
      }
      setAggregates(
        aggregations.map((aggregate, i) => {
          const { total } = aggregate;
          return {
            name: sortedFields[i].name,
            func: funcs[i],
            value: statisticsValue2DisplayValue(funcs[i], total?.value || null, sortedFields[i]),
          };
        })
      );
    });
  }, [funcs, sortedFields, table, viewId]);

  return aggregates;
}
