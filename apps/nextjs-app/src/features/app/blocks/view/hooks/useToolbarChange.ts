import type {
  IGroup,
  IFilter,
  ISort,
  RowHeightLevel,
  IGridStyleOptions,
  IGridViewOptions,
} from '@teable/core';
import { generateLocalId, useGridCollapsedGroupStore } from '@teable/sdk/components';
import { useTableId, useView } from '@teable/sdk/hooks';
import { useMemo, useRef } from 'react';
import { useGridStyleStore } from '../grid/useGridStyleStore';

export const useToolbarChange = () => {
  const tableId = useTableId();
  const view = useView();
  const { setCollapsedGroupMap } = useGridCollapsedGroupStore();
  const setOptimisticGridStyle = useGridStyleStore((state) => state.setStyle);
  const clearOptimisticGridStyle = useGridStyleStore((state) => state.clearStyle);
  const gridStyleUpdateQueueRef = useRef<Promise<unknown>>(Promise.resolve());

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
    const onGridStyleChange = (style: IGridStyleOptions) => {
      if (!view?.id) return Promise.resolve();
      const viewId = view.id;
      const baseStyle = (view.options as IGridViewOptions | undefined)?.style;
      setOptimisticGridStyle(viewId, style, baseStyle);
      const update = gridStyleUpdateQueueRef.current.then(() => view?.updateOption({ style }));
      gridStyleUpdateQueueRef.current = update.catch(() => undefined);
      void update.catch(() => clearOptimisticGridStyle(viewId, style));
      return update;
    };
    return {
      onFilterChange,
      onSortChange,
      onGroupChange,
      onRowHeightChange,
      onFieldNameDisplayLinesChange,
      onGridStyleChange,
    };
  }, [clearOptimisticGridStyle, setCollapsedGroupMap, setOptimisticGridStyle, tableId, view]);
};
