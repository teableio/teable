import type { IGroup, IFilter, ISort, RowHeightLevel } from '@teable-group/core';
import { useView } from '@teable-group/sdk/hooks';
import { useMemo } from 'react';

export const useToolbarChange = () => {
  const view = useView();

  return useMemo(() => {
    const onFilterChange = async (value: IFilter) => {
      await view?.setViewFilter(value);
    };
    const onSortChange = async (value: ISort) => {
      await view?.setViewSort?.(value);
    };
    const onGroupChange = async (value: IGroup) => {
      await view?.setViewGroup?.(value);
    };
    const onRowHeightChange = async (rowHeight: RowHeightLevel) => {
      await view?.setOption({ rowHeight });
    };
    return { onFilterChange, onSortChange, onGroupChange, onRowHeightChange };
  }, [view]);
};
