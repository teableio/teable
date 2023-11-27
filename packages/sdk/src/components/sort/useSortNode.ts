import type { ISort } from '@teable-group/core';
import { ArrowUpDown } from '@teable-group/icons';
import { useMemo } from 'react';

export const useSortNode = (value?: ISort | null) => {
  return useMemo(() => {
    const text =
      !value?.manualSort && value?.sortObjs?.length
        ? `Sort By ${value?.sortObjs?.length} filed${value?.sortObjs?.length > 1 ? 's' : ''}`
        : 'Sort';
    return {
      text,
      isActive: text !== 'Sort',
      Icon: ArrowUpDown,
    };
  }, [value]);
};
