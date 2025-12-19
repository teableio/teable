import { useQuery } from '@tanstack/react-query';
import { getPublishedTemplateCategoryList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useIsMobile } from '@teable/sdk/hooks';
import { cn, Toggle } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { CategoryMenuItem } from './CategoryMenuItem';

const CategoryGroupLabel = ({ label }: { label: string }) => {
  return <span className="text-sm font-medium text-muted-foreground">{label}</span>;
};

interface ICategoryMenuProps {
  currentCategoryId: string | null;
  onCategoryChange: (category: string | null) => void;
  className?: string;
  categoryHeaderRender?: () => React.ReactNode;
  isFeatured: boolean | undefined;
  onFeaturedChange: (isFeatured: boolean | undefined) => void;
  disabledFeaturedToggle: boolean;
}

export const CategoryMenu = (props: ICategoryMenuProps) => {
  const {
    currentCategoryId,
    onCategoryChange,
    className,
    categoryHeaderRender,
    onFeaturedChange,
    isFeatured,
    disabledFeaturedToggle,
  } = props;
  const { t } = useTranslation('common');
  const { data: categoryList } = useQuery({
    queryKey: ReactQueryKeys.publishedTemplateCategoryList(),
    queryFn: () => getPublishedTemplateCategoryList().then((data) => data.data),
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
        <Toggle
          className="flex items-center justify-start"
          pressed={!!isFeatured}
          onPressedChange={(pressed) => {
            if (pressed) {
              onFeaturedChange(true);
            } else {
              onFeaturedChange(undefined);
            }
          }}
          disabled={disabledFeaturedToggle}
        >
          <span>{t('settings.templateAdmin.category.menu.recommended')}</span>
        </Toggle>
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
                onClickHandler={() => {
                  if (currentCategoryId === id) {
                    onCategoryChange(null);
                  } else {
                    onCategoryChange(id);
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
