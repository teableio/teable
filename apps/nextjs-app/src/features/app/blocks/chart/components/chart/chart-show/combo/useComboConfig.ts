import type { IBaseQueryColumn } from '@teable/openapi';
import type { ChartConfig } from '@teable/ui-lib';
import { useMemo } from 'react';
import type { IComboConfig } from '../../../../types';
import { getColor } from '../utils';

export const useComboConfig = (config: IComboConfig, columns?: IBaseQueryColumn[]): ChartConfig => {
  const { xAxis, yAxis } = config;

  return useMemo(() => {
    if (!xAxis || !yAxis || !columns) {
      return {};
    }
    const columnMap = columns.reduce(
      (acc, column) => {
        return {
          ...acc,
          [column.column]: column,
        };
      },
      {} as Record<string, IBaseQueryColumn>
    );
    return yAxis.reduce((acc, y, index) => {
      return {
        ...acc,
        [y.column]: {
          color: getColor(index),
          label: y.label || columnMap[y.column]?.name || y.column,
        },
      };
    }, {} as ChartConfig);
  }, [columns, xAxis, yAxis]);
};
