import { CellValueType, FieldType } from '@teable/core';
import { useBase, useFields, useTable, useViewId } from '@teable/sdk/hooks';
import { useEffect, useMemo, useState } from 'react';

interface IData {
  total: number;
  average: number;
}

export function useLineChartData() {
  const fields = useFields();
  const base = useBase();
  const table = useTable();
  const viewId = useViewId();
  const [data, setData] = useState<{ list: IData[]; title: string }>({ title: '', list: [] });
  const selectField = useMemo(
    () => fields.find((field) => field.type === FieldType.SingleSelect),
    [fields]
  );
  const numberField = useMemo(
    () =>
      fields.find(
        (field) => field.cellValueType === CellValueType.Number && !field.isMultipleCellValue
      ),
    [fields]
  );
  useEffect(() => {
    if (!base || !table || !selectField || !numberField || !viewId) {
      return;
    }
    if (table.id !== selectField.tableId) {
      return;
    }

    const nameColumn = selectField.dbFieldName;
    const numberColumn = numberField.dbFieldName;
    const nativeSql = base
      .knex(table.dbTableName)
      .select(nameColumn)
      .min(numberColumn + ' as total')
      .avg(numberColumn + ' as average')
      .groupBy(nameColumn)
      .toString();

    console.log('useLineChartData:sqlQuery:', nativeSql);
    base.sqlQuery(table.id, viewId, nativeSql).then((result) => {
      console.log('useLineChartData:sqlQuery:', result);
      setData({
        title: numberField.name,
        list: (result.data as IData[]).map(({ total, average }) => ({
          total: total || 0,
          average: average || 0,
        })),
      });
    });
  }, [fields, selectField, numberField, table, viewId, base]);
  return data;
}
