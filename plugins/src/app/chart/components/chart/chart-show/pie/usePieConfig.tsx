import type { ChartConfig } from '@teable/ui-lib';
import { useMemo } from 'react';
import { getColor } from '../utils';

export const usePieConfig = (dimension?: string, rows?: Record<string, unknown>[]): ChartConfig => {
  return useMemo(() => {
    if (!dimension || !rows) {
      return {};
    }
    const labels = rows.map((row) => row[dimension]) as string[];
    return labels.reduce((acc, label, index) => {
      return {
        ...acc,
        [`pie-${index}`]: {
          color: getColor(index),
          label,
        },
      };
    }, {} as ChartConfig);
  }, [dimension, rows]);
};
