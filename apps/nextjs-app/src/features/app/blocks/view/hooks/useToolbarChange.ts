import type { IGroup, IFilter, ISort, RowHeightLevel } from '@teable-group/core';
import { generateLocalId, useGridCollapsedGroupStore } from '@teable-group/sdk/components';
import { useTableId, useView } from '@teable-group/sdk/hooks';
import { useMemo } from 'react';

export const useToolbarChange = () => {
  const tableId = useTableId();
  const view = useView();
  const { setCollapsedGroupMap } = useGridCollapsedGroupStore();

  return useMemo(() => {
    const onFilterChange = async (value: IFilter) => {
      await view?.updateFilter(value);
    };
    const onSortChange = async (value: ISort) => {
      await view?.updateSort?.(value);
    };
    const onGroupChange = async (value: IGroup) => {
      setCollapsedGroupMap(generateLocalId(tableId, view?.id), []);
      await view?.updateGroup?.(value);
    };
    const onRowHeightChange = async (rowHeight: RowHeightLevel) => {
      await view?.updateOption({ rowHeight });
    };
    return { onFilterChange, onSortChange, onGroupChange, onRowHeightChange };
  }, [setCollapsedGroupMap, tableId, view]);
};
