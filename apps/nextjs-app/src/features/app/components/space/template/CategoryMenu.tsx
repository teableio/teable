import { useQuery } from '@tanstack/react-query';
import { getTemplateCategoryList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useIsMobile } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { CategoryMenuItem } from './CategoryMenuItem';

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
  const { currentCategoryId, onCategoryChange, className } = props;
  const { t } = useTranslation('common');
  const { data: categoryListFromServer } = useQuery({
    queryKey: ReactQueryKeys.publishedTemplateCategoryList(),
    queryFn: () => getTemplateCategoryList().then((data) => data.data),
  });

  const isMobile = useIsMobile();

  const categoryList = useMemo(() => {
    return [
      {
        id: null,
        name: t('settings.templateAdmin.category.menu.recommended'),
        order: -Infinity,
      },
      // Widen type so concat is valid (recommended + categories)
      ...(categoryListFromServer ?? []),
    ];
  }, [categoryListFromServer, t]);

  return (
    <div
      className={cn('flex flex-col gap-6 overflow-hidden px-2 pt-4 shrink-0 w-64', className, {
        'flex-row w-full': isMobile,
      })}
    >
      {categoryList && categoryList.length > 0 && (
        <div
          className={cn('flex flex-1 flex-col overflow-hidden', {
            'flex-row overflow-x-auto': isMobile,
          })}
        >
          <div
            className={cn('flex flex-1 flex-col overflow-auto gap-0.5', {
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
                  onCategoryChange(id);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
