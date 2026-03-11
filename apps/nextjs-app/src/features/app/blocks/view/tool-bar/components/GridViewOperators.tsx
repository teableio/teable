import type { RowHeightLevel, IGridViewOptions } from '@teable/core';
import {
  ArrowUpDown,
  Filter as FilterIcon,
  EyeOff,
  LayoutList,
  Share2,
  AlertTriangle,
} from '@teable/icons';
import { HideFields, RowHeight, Sort, Group, ViewFilter } from '@teable/sdk';
import { useView } from '@teable/sdk/hooks/use-view';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { useToolbarChange } from '../../hooks/useToolbarChange';
import { ToolBarButton } from '../ToolBarButton';
import { useToolBarStore } from './useToolBarStore';

export const GridViewOperators: React.FC<{ disabled?: boolean }> = (props) => {
  const { disabled } = props;
  const view = useView();
  const {
    onFilterChange,
    onRowHeightChange,
    onFieldNameDisplayLinesChange,
    onSortChange,
    onGroupChange,
  } = useToolbarChange();
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

  if (!view) {
    return <div></div>;
  }
  return (
    <div className="flex min-w-0 flex-1 gap-1">
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
            <div className="mb-2 flex max-w-full items-center justify-start rounded-md border bg-muted px-3 py-2 text-xs text-muted-foreground dark:bg-white/5">
              <Share2 className="mr-2 size-4 shrink-0" />
              <span className="text-muted-foreground">{t('table:toolbar.viewFilterInShare')}</span>
            </div>
          )
        }
      >
        {(text, isActive, hasWarning) => (
          <ToolBarButton
            disabled={disabled}
            isActive={isActive}
            text={text}
            ref={filterRef}
            className={cn(
              'max-w-[200px]',
              isActive &&
                'bg-violet-100 dark:bg-[#241A31] hover:bg-violet-200 dark:hover:bg-[#322245]',
              hasWarning && 'border-yellow-500'
            )}
            textClassName="@2xl/toolbar:inline"
          >
            <>
              <FilterIcon className="size-4 shrink-0 text-sm" />
              {hasWarning && <AlertTriangle className="size-3.5 shrink-0 text-yellow-500" />}
            </>
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
              'max-w-[200px]',
              isActive &&
                'bg-orange-100 dark:bg-[#2F2518] hover:bg-orange-200 dark:hover:bg-[#392C1B]'
            )}
            textClassName="@2xl/toolbar:inline"
          >
            <ArrowUpDown className="size-4 shrink-0 text-sm" />
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
              'max-w-[200px]',
              isActive &&
                'bg-emerald-100 dark:bg-[#0C3026] hover:bg-emerald-200 dark:hover:bg-[#0D3A2D]'
            )}
            textClassName="@2xl/toolbar:inline"
          >
            <LayoutList className="size-4 shrink-0 text-sm" />
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
        rowHeight={(view?.options as IGridViewOptions)?.rowHeight}
        fieldNameDisplayLines={(view?.options as IGridViewOptions)?.fieldNameDisplayLines}
        onChange={(type, value) => {
          if (type === 'rowHeight') onRowHeightChange(value as RowHeightLevel);
          if (type === 'fieldNameDisplayLines') onFieldNameDisplayLinesChange(value as number);
        }}
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
