import { Filter as FilterIcon, X } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { cn } from '@teable/ui-lib/utils';
import { useTranslation } from '../../context/app/i18n';

interface IFilterEmptyStateProps {
  onClearFilter: () => void;
  className?: string;
}

export const FilterEmptyState = ({ onClearFilter, className }: IFilterEmptyStateProps) => {
  const { t } = useTranslation();

  return (
    <div className={cn('flex flex-col items-center justify-center h-full p-8 text-center', className)}>
      <div className="relative flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-muted">
        <FilterIcon className="w-8 h-8 text-muted-foreground" />
        <div className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 rounded-full bg-destructive">
          <X className="w-3 h-3 text-destructive-foreground" />
        </div>
      </div>
      <h3 className="mb-2 text-lg font-semibold text-foreground">
        {t('filter.emptyState.title')}
      </h3>
      <p className="mb-6 text-sm text-muted-foreground max-w-md">
        {t('filter.emptyState.description')}
      </p>
      <Button variant="default" size="sm" onClick={onClearFilter}>
        <X className="w-4 h-4 mr-2" />
        {t('filter.emptyState.clearFilter')}
      </Button>
    </div>
  );
};
