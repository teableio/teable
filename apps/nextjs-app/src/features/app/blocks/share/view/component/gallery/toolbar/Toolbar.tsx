import { ArrowUpDown, Filter as FilterIcon } from '@teable/icons';
import type { GalleryView } from '@teable/sdk';
import { useView } from '@teable/sdk/hooks/use-view';
import { cn } from '@teable/ui-lib/shadcn';
import { useToolbarChange } from '@/features/app/blocks/view/hooks/useToolbarChange';
import { SearchButton } from '@/features/app/blocks/view/search/SearchButton';
import { ToolBarButton } from '@/features/app/blocks/view/tool-bar/ToolBarButton';
import { Sort } from '../../grid/toolbar/Sort';
import { ShareViewFilter } from '../../share-view-filter';

export const GalleryToolbar: React.FC<{ disabled?: boolean }> = (props) => {
  const { disabled } = props;
  const view = useView() as GalleryView | undefined;
  const { onFilterChange, onSortChange } = useToolbarChange();

  if (!view) return null;

  return (
    <div className="flex w-full items-center justify-between gap-2 border-b px-4 py-2 @container/toolbar">
      <ShareViewFilter filters={view?.filter || null} onChange={onFilterChange}>
        {(text, isActive) => (
          <ToolBarButton
            disabled={disabled}
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
      <div className="flex w-10 flex-1 justify-end">
        <SearchButton shareView />
      </div>
    </div>
  );
};
