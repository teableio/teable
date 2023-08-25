import type { ISelectFieldOptions } from '@teable-group/core';
import { Colors, ColorUtils, CellValueType, FieldType } from '@teable-group/core';
import { useFields, useTable, useView } from '@teable-group/sdk/hooks';
import { Base } from '@teable-group/sdk/model';
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
  const [data, setData] = useState<IData[]>([]);
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
    if (!table || !groupingField || !numberField || !view) {
      return;
    }
    if (table.id !== groupingField.tableId) {
      return;
    }

    const nativeSql = Base.knex(table.dbTableName)
      .select(`${groupingField.dbFieldName} as name`)
      .sum(`${numberField.dbFieldName} as total`)
      .groupBy(groupingField.dbFieldName)
      .orderBy(groupingField.dbFieldName, 'desc')
      .toString();

    console.log('sqlQuery:', nativeSql);
    Base.sqlQuery(table.id, view.id, nativeSql).then((result) => {
      console.log('sqlQuery:', result);
      setData(
        (result as IData[]).map(({ total, name }) => ({
          name: name || 'Untitled',
          total: total || 0,
          color: ColorUtils.getHexForColor(
            (groupingField.options as ISelectFieldOptions).choices.find((c) => c.name === name)
              ?.color || Colors.TealLight1
          ),
        }))
      );
    });
  }, [fields, groupingField, numberField, table, view]);
  return data;
}
