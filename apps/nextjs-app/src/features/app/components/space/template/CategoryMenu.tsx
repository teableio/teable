import { useQuery } from '@tanstack/react-query';
import { getTemplateCategoryList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { CategoryMenuItem } from './CategoryMenuItem';

const CategoryGroupLabel = ({ label }: { label: string }) => {
  return <span className="text-sm font-medium text-muted-foreground">{label}</span>;
};

interface ICategoryMenuProps {
  currentCategoryId: string;
  onCategoryChange: (category: string) => void;
  className?: string;
  categoryHeaderRender?: () => React.ReactNode;
}

export const CategoryMenu = (props: ICategoryMenuProps) => {
  const { currentCategoryId, onCategoryChange, className, categoryHeaderRender } = props;
  const { t } = useTranslation('common');
  const { data: categoryList } = useQuery({
    queryKey: ReactQueryKeys.templateCategoryList(),
    queryFn: () => getTemplateCategoryList().then((data) => data.data),
  });

  return (
    <div className={cn('flex flex-col gap-3 overflow-hidden p-2 shrink-0 w-64', className)}>
      <div className="flex flex-col gap-1">
        {categoryHeaderRender && categoryHeaderRender()}
        <CategoryGroupLabel label={t('settings.templateAdmin.category.menu.getStarted')} />
        <CategoryMenuItem
          key={'all'}
          id={'all'}
          category={t('settings.templateAdmin.category.menu.all')}
          currentCategoryId={currentCategoryId}
          onClickHandler={() => onCategoryChange('all')}
        />
      </div>

      {categoryList && categoryList.length > 0 && (
        <div className="flex flex-1 flex-col gap-1 overflow-hidden">
          <CategoryGroupLabel label={t('settings.templateAdmin.category.menu.browseByCategory')} />

          <div className="flex flex-1 flex-col gap-y-1 overflow-auto">
            {categoryList?.map(({ name, id }) => (
              <CategoryMenuItem
                key={id}
                category={name}
                id={id}
                currentCategoryId={currentCategoryId}
                onClickHandler={() => onCategoryChange(id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
