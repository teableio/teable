import { type IGridViewOptions } from '@teable/core';
import { ArrowUpDown, Filter as FilterIcon, EyeOff, LayoutList, Share2 } from '@teable/icons';
import { HideFields, RowHeight, useFields, Sort, Group, ViewFilter } from '@teable/sdk';
import { useView } from '@teable/sdk/hooks/use-view';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef } from 'react';
import { GUIDE_VIEW_FILTERING, GUIDE_VIEW_SORTING, GUIDE_VIEW_GROUPING } from '@/components/Guide';
import { tableConfig } from '@/features/i18n/table.config';
import { useToolbarChange } from '../../hooks/useToolbarChange';
import { ToolBarButton } from '../ToolBarButton';
import { useToolBarStore } from './useToolBarStore';

export const GridViewOperators: React.FC<{ disabled?: boolean }> = (props) => {
  const { disabled } = props;
  const view = useView();
  const fields = useFields();
  const { onFilterChange, onRowHeightChange, onSortChange, onGroupChange } = useToolbarChange();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { setFilterRef, setSortRef, setGroupRef } = useToolBarStore();
  const filterRef = useRef<HTMLButtonElement>(null);
  const sortRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setFilterRef(filterRef);
    setSortRef(sortRef);
    setGroupRef(groupRef);
  }, [setFilterRef, setGroupRef, setSortRef]);

  if (!view || !fields.length) {
    return <div></div>;
  }
  return (
    <div className="flex @sm/toolbar:gap-1">
      <HideFields>
        {(text, isActive) => (
          <ToolBarButton
            disabled={disabled}
            isActive={isActive}
            text={text}
            textClassName="@2xl/toolbar:inline"
          >
            <EyeOff className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </HideFields>
      <ViewFilter
        filters={view?.filter || null}
        onChange={onFilterChange}
        contentHeader={
          view.enableShare && (
            <div className="flex max-w-full items-center justify-start rounded-t bg-accent px-4 py-2 text-[11px]">
              <Share2 className="mr-4 size-4 shrink-0" />
              <span className="text-muted-foreground">{t('table:toolbar.viewFilterInShare')}</span>
            </div>
          )
        }
      >
        {(text, isActive) => (
          <ToolBarButton
            disabled={disabled}
            isActive={isActive}
            text={text}
            ref={filterRef}
            className={cn(
              GUIDE_VIEW_FILTERING,
              'max-w-xs',
              isActive &&
                'bg-violet-100 dark:bg-violet-600/30 hover:bg-violet-200 dark:hover:bg-violet-500/30'
            )}
            textClassName="@2xl/toolbar:inline"
          >
            <FilterIcon className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </ViewFilter>
      <Sort sorts={view?.sort || null} onChange={onSortChange}>
        {(text: string, isActive) => (
          <ToolBarButton
            disabled={disabled}
            isActive={isActive}
            text={text}
            ref={sortRef}
            className={cn(
              GUIDE_VIEW_SORTING,
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
            disabled={disabled}
            isActive={isActive}
            text={text}
            ref={groupRef}
            className={cn(
              GUIDE_VIEW_GROUPING,
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
      {/* <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {
              // disabled doesn't trigger the tooltip, so wrap div
            }
            <div>
              <Color>
                {(text: string, isActive) => (
                  <ToolBarButton
                    disabled={true}
                    isActive={isActive}
                    text={text}
                    className={cn(
                      GUIDE_VIEW_GROUPING,
                      'max-w-xs',
                      isActive &&
                        'bg-green-100 dark:bg-green-600/30 hover:bg-green-200 dark:hover:bg-green-500/30'
                    )}
                    textClassName="@2xl/toolbar:inline"
                  >
                    <PaintBucket className="size-4 text-sm" />
                  </ToolBarButton>
                )}
              </Color>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('table:toolbar.comingSoon')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider> */}

      <RowHeight
        rowHeight={(view?.options as IGridViewOptions)?.rowHeight || null}
        onChange={onRowHeightChange}
      >
        {(_, isActive, Icon) => (
          <ToolBarButton disabled={disabled} isActive={isActive}>
            <Icon className="text-sm" />
          </ToolBarButton>
        )}
      </RowHeight>
    </div>
  );
};
