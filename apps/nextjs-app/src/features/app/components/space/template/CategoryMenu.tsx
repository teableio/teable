import { useQuery } from '@tanstack/react-query';
import type { ITemplateCategoryListVo } from '@teable/openapi';
import { getPublishedTemplateCategoryList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useIsMobile } from '@teable/sdk/hooks';
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
  serverPublishedTemplateCategoryList?: ITemplateCategoryListVo[];
}

export const CategoryMenu = (props: ICategoryMenuProps) => {
  const {
    currentCategoryId,
    onCategoryChange,
    className,
    categoryHeaderRender,
    serverPublishedTemplateCategoryList,
  } = props;
  const { t } = useTranslation('common');
  const { data: categoryList } = useQuery({
    queryKey: ReactQueryKeys.publishedTemplateCategoryList(),
    queryFn: () => getPublishedTemplateCategoryList().then((data) => data.data),
    initialData: serverPublishedTemplateCategoryList,
  });

  const isMobile = useIsMobile();

  return (
    <div
      className={cn('flex flex-col gap-3 overflow-hidden p-2 shrink-0 w-64', className, {
        'flex-row w-full': isMobile,
      })}
    >
      {isMobile && categoryHeaderRender && categoryHeaderRender()}
      <div className="flex flex-col gap-1">
        {!isMobile && categoryHeaderRender && categoryHeaderRender()}
        {!isMobile && (
          <CategoryGroupLabel label={t('settings.templateAdmin.category.menu.getStarted')} />
        )}
        <CategoryMenuItem
          key={'all'}
          id={'all'}
          category={t('settings.templateAdmin.category.menu.all')}
          currentCategoryId={currentCategoryId}
          onClickHandler={() => onCategoryChange('all')}
        />
      </div>

      {categoryList && categoryList.length > 0 && (
        <div
          className={cn('flex flex-1 flex-col gap-1 overflow-hidden', {
            'flex-row overflow-x-auto': isMobile,
          })}
        >
          {!isMobile && (
            <CategoryGroupLabel
              label={t('settings.templateAdmin.category.menu.browseByCategory')}
            />
          )}

          <div
            className={cn('flex flex-1 flex-col gap-y-1 overflow-auto', {
              'flex-row gap-x-0.5': isMobile,
            })}
          >
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
