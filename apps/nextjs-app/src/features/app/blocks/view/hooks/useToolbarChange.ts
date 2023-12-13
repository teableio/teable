import { ViewType, type IFilter, type ISort, type RowHeightLevel } from '@teable-group/core';
import { useTableId, useView } from '@teable-group/sdk/hooks';
import { useMemo } from 'react';

export const useToolbarChange = () => {
  const view = useView();
  const tableId = useTableId();

  return useMemo(() => {
    const onFilterChange = async (filters: IFilter | null) => {
      await view?.setFilter(filters);
    };
    const onSortChange = async (value: ISort | null) => {
      await view?.setSort?.(value);
    };
    const onRowHeightChange = async (rowHeight: RowHeightLevel) => {
      if (view?.type === ViewType.Grid && tableId) {
        await view.updateRowHeight(tableId, rowHeight);
      }
    };
    return { onFilterChange, onSortChange, onRowHeightChange };
  }, [tableId, view]);
};
