import { ArrowUpDown, Filter as FilterIcon, Layers } from '@teable/icons';
import type { KanbanView } from '@teable/sdk';
import { useFields } from '@teable/sdk';
import { useView } from '@teable/sdk/hooks/use-view';
import { cn } from '@teable/ui-lib/shadcn';
import { Trans } from 'next-i18next';
import { useMemo } from 'react';
import { useToolbarChange } from '@/features/app/blocks/view/hooks/useToolbarChange';
import { SearchButton } from '@/features/app/blocks/view/search/SearchButton';
import { ToolBarButton } from '@/features/app/blocks/view/tool-bar/ToolBarButton';
import { Sort } from '../../grid/toolbar/Sort';
import { ShareViewFilter } from '../../share-view-filter';

export const KanbanToolbar: React.FC<{ disabled?: boolean }> = (props) => {
  const { disabled } = props;
  const view = useView() as KanbanView | undefined;
  const allFields = useFields({ withHidden: true, withDenied: true });
  const { onFilterChange, onSortChange } = useToolbarChange();
  const { stackFieldId } = view?.options ?? {};
  const stackFieldName = useMemo(() => {
    if (stackFieldId == null) return '';
    const groupField = allFields.find(({ id }) => id === stackFieldId);
    return groupField != null ? groupField.name : '';
  }, [allFields, stackFieldId]);

  if (!view) return null;

  return (
    <div className="flex w-full items-center justify-between gap-2 border-b px-4 py-2 @container/toolbar">
      <ToolBarButton
        disabled
        text={
          <Trans ns="table" i18nKey={'kanban.toolbar.stackedBy'}>
            {stackFieldName}
          </Trans>
        }
        textClassName="@2xl/toolbar:inline"
      >
        <Layers className="size-4 text-sm" />
      </ToolBarButton>
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
