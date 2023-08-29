import type { StatisticsFunc } from '@teable-group/core';
import { CellValueType } from '@teable-group/core';
import { useFields, useTable, useViewId } from '@teable-group/sdk/hooks';
import { View } from '@teable-group/sdk/model';
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

  console.log('sortedFields', sortedFields);

  useEffect(() => {
    if (!sortedFields.length || sortedFields[0].tableId !== table?.id) {
      return;
    }

    const promises = funcs.map((func, i) => {
      const field = sortedFields[i];
      if (!field || !table?.id || !viewId) {
        return;
      }
      return View.getViewAggregation(table.id, viewId, {
        field: {
          [func]: [field.id],
        },
      });
    });

    // promises.
    // console.log(promises);
    // if (table?.id && viewId) {
    //   View.getViewAggregation(table.id, viewId, {
    //     field: {
    //       average: ['fldQLZIifmSf2Sw3jiO', 'fldTeyAHzbkXVZgPerx'],
    //       sum: ['fldTeyAHzbkXVZgPerx', 'fldTeyAHzbkXVZgPerx'],
    //     },
    //   }).then((aggregates) => {
    //     console.log('aggregates', aggregates);
    //   });
    // }

    Promise.all(promises).then(
      (aggregates) => {
        console.log('aggregates', aggregates);
      }
      // setAggregates(
      //   aggregates.map((aggregate, i) => {
      //     if (!aggregate) return null;
      //     return {
      //       value: statisticsValue2DisplayValue(
      //         funcs[i],
      //         aggregate?.value || null,
      //         sortedFields[i]
      //       ),
      //       name: sortedFields[i].name,
      //       func: funcs[i],
      //     };
      //   })
      // )
    );
  }, [funcs, sortedFields, table, viewId]);

  return aggregates;
}
