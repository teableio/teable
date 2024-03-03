import type { ISelectFieldOptions } from '@teable/core';
import { Colors, ColorUtils, CellValueType, FieldType } from '@teable/core';
import { useBase, useFields, useTable, useView } from '@teable/sdk/hooks';
import { useEffect, useMemo, useState } from 'react';

interface IData {
  name: string;
  color: string;
  total: number;
}

export function useChartData() {
  const fields = useFields();
  const table = useTable();
  const view = useView();
  const base = useBase();
  const [data, setData] = useState<{ list: IData[]; title: string }>({ title: '', list: [] });
  const groupingField = useMemo(
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
    if (!base || !table || !groupingField || !numberField || !view) {
      return;
    }
    if (table.id !== groupingField.tableId) {
      return;
    }

    const nativeSql = base
      .knex(table.dbTableName)
      .select(`${groupingField.dbFieldName} as name`)
      .sum(`${numberField.dbFieldName} as total`)
      .groupBy(groupingField.dbFieldName)
      .orderBy(groupingField.dbFieldName, 'desc')
      .toString();

    console.log('sqlQuery:', nativeSql);
    base.sqlQuery(table.id, view.id, nativeSql).then((result) => {
      console.log('sqlQuery:', result);
      setData({
        title: numberField.name,
        list: (result.data as IData[]).map(({ total, name }) => ({
          name: name || 'Untitled',
          total: total || 0,
          color: ColorUtils.getHexForColor(
            (groupingField.options as ISelectFieldOptions).choices.find((c) => c.name === name)
              ?.color || Colors.TealLight1
          ),
        })),
      });
    });
  }, [base, fields, groupingField, numberField, table, view]);
  return data;
}
