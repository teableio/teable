import type { IGroup, IFilter, ISort, RowHeightLevel } from '@teable/core';
import { generateLocalId, useGridCollapsedGroupStore } from '@teable/sdk/components';
import { useTableId, useView } from '@teable/sdk/hooks';
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
    const onFieldNameDisplayLinesChange = async (fieldNameDisplayLines: number) => {
      await view?.updateOption({ fieldNameDisplayLines });
    };
    return {
      onFilterChange,
      onSortChange,
      onGroupChange,
      onRowHeightChange,
      onFieldNameDisplayLinesChange,
    };
  }, [setCollapsedGroupMap, tableId, view]);
};
