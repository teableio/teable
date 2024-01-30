import type { GridViewOptions } from '@teable/core';
import { ArrowUpDown, Filter as FilterIcon, LayoutList } from '@teable/icons';
import { Filter, useView, RowHeight, Group } from '@teable/sdk';
import { useToolbarChange } from '@/features/app/blocks/view/hooks/useToolbarChange';
import { ToolBarButton } from '@/features/app/blocks/view/tool-bar/ToolBarButton';
import { Sort } from './Sort';

export const Toolbar = () => {
  const view = useView();

  const { onFilterChange, onRowHeightChange, onSortChange, onGroupChange } = useToolbarChange();

  if (!view) {
    return <></>;
  }

  return (
    <div className="flex items-center gap-2 border-b px-4 py-2 @container/toolbar">
      <Filter filters={view?.filter || null} onChange={onFilterChange}>
        {(text, isActive) => (
          <ToolBarButton isActive={isActive} text={text} className="max-w-xs">
            <FilterIcon className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </Filter>
      <Sort sorts={view?.sort || null} onChange={onSortChange}>
        {(text: string, isActive) => (
          <ToolBarButton isActive={isActive} text={text}>
            <ArrowUpDown className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </Sort>
      <Group group={view?.group || null} onChange={onGroupChange}>
        {(text: string, isActive) => (
          <ToolBarButton isActive={isActive} text={text}>
            <LayoutList className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </Group>
      <RowHeight
        rowHeight={(view?.options as GridViewOptions)?.rowHeight || null}
        onChange={onRowHeightChange}
      >
        {(_, isActive, Icon) => (
          <ToolBarButton isActive={isActive}>
            <Icon className="text-sm" />
          </ToolBarButton>
        )}
      </RowHeight>
    </div>
  );
};
