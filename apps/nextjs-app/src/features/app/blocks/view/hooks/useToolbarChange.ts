import { ViewType } from '@teable-group/core';
import type { IGroup, IFilter, ISort, RowHeightLevel } from '@teable-group/core';
import { useView } from '@teable-group/sdk/hooks';
import { useMemo } from 'react';

export const useToolbarChange = () => {
  const view = useView();

  return useMemo(() => {
    const onFilterChange = async (filters: IFilter | null) => {
      await view?.setFilter(filters);
    };
    const onSortChange = async (value: ISort | null) => {
      await view?.setSort?.(value);
    };
    const onGroupChange = async (value: IGroup | null) => {
      await view?.setGroup?.(value);
    };
    const onRowHeightChange = async (rowHeight: RowHeightLevel) => {
      if (view?.type === ViewType.Grid) {
        await view.updateRowHeight(rowHeight);
      }
    };
    return { onFilterChange, onSortChange, onGroupChange, onRowHeightChange };
  }, [view]);
};
