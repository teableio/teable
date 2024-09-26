import type { IBaseQueryColumn } from '@teable/openapi';
import { BaseQueryColumnType } from '@teable/openapi';
import { useMemo } from 'react';

export const useFilterNumberColumns = (columns?: IBaseQueryColumn[]) => {
  return useMemo(() => {
    return (
      columns?.filter(
        (column) =>
          column.type === BaseQueryColumnType.Aggregation ||
          (column.fieldSource &&
            column.fieldSource?.cellValueType === 'number' &&
            !column.fieldSource.isMultipleCellValue)
      ) ?? []
    );
  }, [columns]);
};
