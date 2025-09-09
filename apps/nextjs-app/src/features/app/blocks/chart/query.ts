import type { IBaseQueryVo } from '@teable/openapi';

export const formatRes = (res?: IBaseQueryVo): IBaseQueryVo => {
  if (!res) {
    return {
      rows: [],
      columns: [],
    };
  }
  const { columns, rows } = res;
  // recharts does not support column name with space
  const formatColumn = (column: string) => column.replaceAll(' ', '_');
  return {
    columns: columns.map((column) => ({
      ...column,
      column: formatColumn(column.column),
    })),
    rows: rows.map((row) => {
      const newRow: Record<string, unknown> = {};
      columns.forEach((column) => {
        newRow[formatColumn(column.column)] = row[column.column];
      });
      return newRow;
    }),
  };
};
