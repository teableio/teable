import type { IFilter, ISort } from '@teable-group/core';
import { useView } from '@teable-group/sdk/hooks';
import { useMemo } from 'react';

export const useFilterChange = () => {
  const view = useView();

  return useMemo(() => {
    const onFilterChange = async (filters: IFilter | null) => {
      await view?.setFilter(filters);
    };
    const onSortChange = async (value: ISort | null) => {
      await view?.setSort?.(value);
    };
    return { onFilterChange, onSortChange };
  }, [view]);
};
