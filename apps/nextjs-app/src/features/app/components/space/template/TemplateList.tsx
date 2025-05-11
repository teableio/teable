import { useQuery } from '@tanstack/react-query';
import type { ITemplateVo } from '@teable/openapi';
import { getPublishedTemplateList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { cn } from '@teable/ui-lib/shadcn';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TemplateCard } from './TemplateCard';
import type { ITemplateBaseProps } from './TemplateMain';

interface ITemplateListProps extends ITemplateBaseProps {
  currentCategoryId: string;
  search: string;
  className?: string;
  serverPublishedTemplateList?: ITemplateVo[];
}

export const TemplateList = (props: ITemplateListProps) => {
  const {
    currentCategoryId,
    search,
    onClickUseTemplateHandler,
    onClickTemplateCardHandler,
    className,
    serverPublishedTemplateList,
  } = props;
  const { t } = useTranslation(['common']);
  const { data: publishedTemplateList } = useQuery({
    queryKey: ReactQueryKeys.publishedTemplateList(),
    queryFn: () => getPublishedTemplateList().then((data) => data.data),
    initialData: serverPublishedTemplateList,
  });

  const currentTemplateList = useMemo(() => {
    const categoryList =
      currentCategoryId === 'all'
        ? publishedTemplateList
        : publishedTemplateList?.filter(({ categoryId }) => categoryId === currentCategoryId);

    if (search) {
      return categoryList?.filter(({ name }) =>
        name?.toLocaleLowerCase()?.includes(search?.toLocaleLowerCase())
      );
    }

    return categoryList;
  }, [currentCategoryId, publishedTemplateList, search]);

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 text-left sm:grid-cols-2 lg:grid-cols-3 flex-1',
        {
          'grid-cols-1 sm:grid-cols-1 lg:grid-cols-1': currentTemplateList?.length === 0,
        },
        className
      )}
    >
      {currentTemplateList?.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          onClickUseTemplateHandler={onClickUseTemplateHandler}
          onClickTemplateCardHandler={onClickTemplateCardHandler}
        />
      ))}

      {currentTemplateList?.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-gray-500">{t('common:noResult')}</p>
        </div>
      )}
    </div>
  );
};
