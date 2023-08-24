import { CellValueType, FieldType } from '@teable-group/core';
import { useFields, useTable } from '@teable-group/sdk/hooks';
import { Base } from '@teable-group/sdk/model';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

interface IData {
  name: string;
  total: number;
}

export function Overview() {
  const fields = useFields();
  const table = useTable();
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
    if (!table || !groupingField || !numberField) {
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
      .toSQL()
      .toNative();

    console.log('sqlQuery:', nativeSql);
    Base.sqlQuery(nativeSql).then((result) => {
      console.log('sqlQuery:', result);
      setData(
        (result as IData[]).map(({ total, name }) => ({
          name: name || 'Untitled',
          total: total || 0,
        }))
      );
    });
  }, [fields, groupingField, numberField, table]);

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={data}>
        <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `$${value}`}
        />
        <Bar dataKey="total" fill="#adfa1d" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
