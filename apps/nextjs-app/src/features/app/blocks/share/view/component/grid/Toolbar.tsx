import type { GridViewOptions } from '@teable-group/core';
import { ArrowUpDown, Filter as FilterIcon } from '@teable-group/icons';
import { Filter, useView, RowHeight, Sort } from '@teable-group/sdk';
import { useToolbarChange } from '@/features/app/blocks/view/hooks/useToolbarChange';
import { ToolBarButton } from '@/features/app/blocks/view/tool-bar/ToolBarButton';

export const Toolbar = () => {
  const view = useView();

  const { onFilterChange, onRowHeightChange, onSortChange } = useToolbarChange();

  if (!view) {
    return <></>;
  }

  return (
    <div className="flex items-center gap-2 border-b px-4 py-2 @container/toolbar">
      <Filter filters={view?.filter || null} onChange={onFilterChange}>
        {(text, isActive) => (
          <ToolBarButton isActive={isActive} text={text} className="max-w-xs">
            <FilterIcon className="h-4 w-4 text-sm" />
          </ToolBarButton>
        )}
      </Filter>
      <Sort sorts={view?.sort || null} onChange={onSortChange}>
        {(text: string, isActive) => (
          <ToolBarButton isActive={isActive} text={text}>
            <ArrowUpDown className="h-4 w-4 text-sm" />
          </ToolBarButton>
        )}
      </Sort>
      <RowHeight
        rowHeight={(view?.options as GridViewOptions)?.rowHeight || null}
        onChange={onRowHeightChange}
      >
        {(text, isActive, Icon) => (
          <ToolBarButton isActive={isActive} text={text}>
            <Icon className="text-sm" />
          </ToolBarButton>
        )}
      </RowHeight>
    </div>
  );
};
