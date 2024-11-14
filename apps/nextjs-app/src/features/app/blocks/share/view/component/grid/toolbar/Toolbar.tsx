import { type IGridViewOptions } from '@teable/core';
import { ArrowUpDown, EyeOff, Filter as FilterIcon, LayoutList } from '@teable/icons';
import { useView, RowHeight, Group, HideFields } from '@teable/sdk';
import { cn } from '@teable/ui-lib/shadcn';
import { useToolbarChange } from '@/features/app/blocks/view/hooks/useToolbarChange';
import { SearchButton } from '@/features/app/blocks/view/search/SearchButton';
import { ToolBarButton } from '@/features/app/blocks/view/tool-bar/ToolBarButton';
import { ShareViewFilter } from '../../share-view-filter';
import { Sort } from './Sort';

export const Toolbar = () => {
  const view = useView();

  const { onFilterChange, onRowHeightChange, onSortChange, onGroupChange } = useToolbarChange();

  if (!view) {
    return <></>;
  }

  return (
    <div className="flex w-full items-center justify-between gap-2 border-b px-4 py-2 @container/toolbar">
      <HideFields>
        {(text, isActive) => (
          <ToolBarButton isActive={isActive} text={text} textClassName="@2xl/toolbar:inline">
            <EyeOff className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </HideFields>
      <ShareViewFilter filters={view?.filter || null} onChange={onFilterChange}>
        {(text, isActive) => (
          <ToolBarButton
            isActive={isActive}
            text={text}
            className={cn(
              'max-w-xs',
              isActive &&
                'bg-violet-100 dark:bg-violet-600/30 hover:bg-violet-200 dark:hover:bg-violet-500/30'
            )}
            textClassName="@2xl/toolbar:inline"
          >
            <FilterIcon className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </ShareViewFilter>
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
            textClassName="@2xl/toolbar:inline"
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
            textClassName="@2xl/toolbar:inline"
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
      <div className="flex w-10 flex-1 justify-end">
        <SearchButton shareView />
      </div>
    </div>
  );
};
