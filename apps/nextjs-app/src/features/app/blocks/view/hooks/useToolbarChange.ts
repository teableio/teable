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
      await view?.setViewFilter(value);
    };
    const onSortChange = async (value: ISort) => {
      await view?.setViewSort?.(value);
    };
    const onGroupChange = async (value: IGroup) => {
      setCollapsedGroupMap(generateLocalId(tableId, view?.id), []);
      await view?.setViewGroup?.(value);
    };
    const onRowHeightChange = async (rowHeight: RowHeightLevel) => {
      await view?.setOption({ rowHeight });
    };
    return { onFilterChange, onSortChange, onGroupChange, onRowHeightChange };
  }, [setCollapsedGroupMap, tableId, view]);
};
