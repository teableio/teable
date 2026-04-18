import type { IFilter, ISort } from '@teable/core';
import { Filter as FilterIcon, ArrowUpDown, X, Trash2 } from '@teable/icons';
import { Badge } from '@teable/ui-lib/shadcn/ui/badge';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib/shadcn/ui/tooltip';
import { cn } from '@teable/ui-lib/utils';
import { useTranslation } from '../../context/app/i18n';
import { useFields } from '../../hooks';
import type { IFieldInstance } from '../../model';
import type { IFilterLabel, ISortLabel } from './view-filter/hooks/useFilterSortStatus';
import { useFilterSortStatus } from './view-filter/hooks';

interface IFilterSortStatusBarProps {
  filter: IFilter | null | undefined;
  sort: ISort | null | undefined;
  fields?: IFieldInstance[];
  onFilterChange: (filter: IFilter | null) => void;
  onSortChange: (sort: ISort | null) => void;
  className?: string;
}

interface IFilterBadgeProps {
  label: IFilterLabel;
  onRemove: () => void;
}

interface ISortBadgeProps {
  label: ISortLabel;
  onRemove: () => void;
}

const FilterBadge = ({ label, onRemove }: IFilterBadgeProps) => {
  const { t } = useTranslation();
  const displayText = label.valueLabel
    ? `${label.fieldName} ${label.operatorLabel} ${label.valueLabel}`
    : `${label.fieldName} ${label.operatorLabel}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="secondary"
            className="group flex items-center gap-1.5 pl-2 pr-1 py-1 cursor-default bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-800/40 border-violet-200 dark:border-violet-700"
          >
            <FilterIcon className="size-3" />
            <span className="max-w-[200px] truncate">{displayText}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-violet-200 dark:hover:bg-violet-700 rounded-full"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <X className="size-3" />
            </Button>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('filter.removeTip')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const SortBadge = ({ label, onRemove }: ISortBadgeProps) => {
  const { t } = useTranslation();
  const displayText = `${label.fieldName} ${label.orderLabel}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="secondary"
            className="group flex items-center gap-1.5 pl-2 pr-1 py-1 cursor-default bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-800/40 border-orange-200 dark:border-orange-700"
          >
            <ArrowUpDown className="size-3" />
            <span className="max-w-[200px] truncate">{displayText}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-orange-200 dark:hover:bg-orange-700 rounded-full"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <X className="size-3" />
            </Button>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('sort.removeTip')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const FilterSortStatusBar = ({
  filter,
  sort,
  fields: propsFields,
  onFilterChange,
  onSortChange,
  className,
}: IFilterSortStatusBarProps) => {
  const { t } = useTranslation();
  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = propsFields ?? defaultFields;

  const {
    filterLabels,
    sortLabels,
    hasActiveFilters,
    hasActiveSorts,
    hasActiveConditions,
    removeFilterItem,
    removeSortItem,
    clearAllFilters,
    clearAllSorts,
    clearAll,
  } = useFilterSortStatus(filter, sort, fields);

  if (!hasActiveConditions) {
    return null;
  }

  const handleRemoveFilter = (path: (string | number)[]) => {
    const newFilter = removeFilterItem(path);
    onFilterChange(newFilter);
  };

  const handleRemoveSort = (index: number) => {
    const newSort = removeSortItem(index);
    onSortChange(newSort);
  };

  const handleClearAllFilters = () => {
    onFilterChange(clearAllFilters());
  };

  const handleClearAllSorts = () => {
    onSortChange(clearAllSorts());
  };

  const handleClearAll = () => {
    const { filter: newFilter, sort: newSort } = clearAll();
    onFilterChange(newFilter);
    onSortChange(newSort);
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-background/50 min-h-[40px]',
        className
      )}
    >
      {hasActiveFilters && (
        <div className="flex items-center gap-1.5">
          <FilterIcon className="size-4 text-violet-500" />
          <div className="flex flex-wrap items-center gap-1.5">
            {filterLabels.map((label) => (
              <FilterBadge
                key={label.id}
                label={label}
                onRemove={() => handleRemoveFilter(label.path)}
              />
            ))}
          </div>
          {filterLabels.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30"
              onClick={handleClearAllFilters}
            >
              {t('filter.clearAll')}
            </Button>
          )}
        </div>
      )}

      {hasActiveFilters && hasActiveSorts && (
        <div className="w-px h-6 bg-border mx-1" />
      )}

      {hasActiveSorts && (
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="size-4 text-orange-500" />
          <div className="flex flex-wrap items-center gap-1.5">
            {sortLabels.map((label) => (
              <SortBadge
                key={label.id}
                label={label}
                onRemove={() => handleRemoveSort(label.index)}
              />
            ))}
          </div>
          {sortLabels.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/30"
              onClick={handleClearAllSorts}
            >
              {t('sort.clearAll')}
            </Button>
          )}
        </div>
      )}

      <div className="flex-1" />

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground hover:text-destructive"
              onClick={handleClearAll}
            >
              <Trash2 className="size-3.5 mr-1" />
              {t('filterSort.clearAll')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('filterSort.clearAllTip')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};
