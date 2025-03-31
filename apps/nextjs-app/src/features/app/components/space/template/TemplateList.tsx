import { useQuery } from '@tanstack/react-query';
import { getPublishedTemplateList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TemplateCard } from './TemplateCard';

interface ITemplateListProps {
  currentCategoryId: string;
  search: string;
}

export const TemplateList = (props: ITemplateListProps) => {
  const { currentCategoryId, search } = props;
  const { t } = useTranslation(['common']);
  const { data: publishedTemplateList } = useQuery({
    queryKey: ReactQueryKeys.templateList(),
    queryFn: () => getPublishedTemplateList().then((data) => data.data),
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
    <div className="flex flex-1 flex-wrap gap-3 overflow-y-auto p-2">
      {currentTemplateList?.map((template) => (
        <TemplateCard key={template.id} template={template} />
      ))}

      {currentTemplateList?.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-gray-500">{t('common:noResult')}</p>
        </div>
      )}
    </div>
  );
};
