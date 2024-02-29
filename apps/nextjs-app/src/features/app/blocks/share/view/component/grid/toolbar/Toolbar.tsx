import type { IGridViewOptions } from '@teable/core';
import { ArrowUpDown, Filter as FilterIcon, LayoutList } from '@teable/icons';
import { Filter, useView, RowHeight, Group } from '@teable/sdk';
import { cn } from '@teable/ui-lib/shadcn';
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
          <ToolBarButton
            isActive={isActive}
            text={text}
            className={cn(
              'max-w-xs',
              isActive &&
                'bg-violet-100 dark:bg-violet-600/30 hover:bg-violet-200 dark:hover:bg-violet-500/30'
            )}
          >
            <FilterIcon className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </Filter>
      <Sort sorts={view?.sort || null} onChange={onSortChange}>
        {(text: string, isActive) => (
          <ToolBarButton
            isActive={isActive}
            text={text}
            className={cn(
              'max-w-xs',
              isActive &&
                'bg-orange-100 dark:bg-orange-600/30 hover:bg-orange-200 dark:hover:bg-orange-500/30'
            )}
          >
            <ArrowUpDown className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </Sort>
      <Group group={view?.group || null} onChange={onGroupChange}>
        {(text: string, isActive) => (
          <ToolBarButton
            isActive={isActive}
            text={text}
            className={cn(
              'max-w-xs',
              isActive &&
                'bg-green-100 dark:bg-green-600/30 hover:bg-green-200 dark:hover:bg-green-500/30'
            )}
          >
            <LayoutList className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </Group>
      <RowHeight
        rowHeight={(view?.options as IGridViewOptions)?.rowHeight || null}
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
