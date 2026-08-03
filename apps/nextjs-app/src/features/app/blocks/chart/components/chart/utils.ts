import type { IBaseQueryColumn } from '@teable/openapi';
import type { ITableConfigColumn } from '../../types';

const isEmptyObject = (obj: Record<string, unknown>) => {
  return Object.keys(obj).length === 0 && obj.constructor === Object;
};

export const sortTableColumns = (
  columns: IBaseQueryColumn[],
  configColumnMap: Record<string, ITableConfigColumn & { index: number }>
) => {
  if (isEmptyObject(configColumnMap)) {
    return columns;
  }
  return columns.sort((a, b) => {
    const aIndex = configColumnMap[a.column]?.index ?? -1;
    const bIndex = configColumnMap[b.column]?.index ?? -1;
    return aIndex - bIndex;
  });
};

export const tableConfigColumnsToMap = (configColumns?: ITableConfigColumn[]) => {
  if (!configColumns) {
    return {};
  }
  return configColumns.reduce(
    (acc, column, index) => {
      acc[column.column] = {
        ...column,
        index,
      };
      return acc;
    },
    {} as Record<string, ITableConfigColumn & { index: number }>
  );
};
