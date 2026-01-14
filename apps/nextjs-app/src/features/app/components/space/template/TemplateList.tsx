import { useInfiniteQuery } from '@tanstack/react-query';
import { getPublishedTemplateList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Spin } from '@teable/ui-lib/base';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TemplateCard } from './TemplateCard';
import type { ITemplateBaseProps } from './TemplateMain';

interface ITemplateListProps extends ITemplateBaseProps {
  currentCategoryId: string | null;
  search: string;
  className?: string;
  isFeatured: boolean | undefined;
}

const PAGE_SIZE = 2 * 3 * 2;

export const TemplateList = (props: ITemplateListProps) => {
  const { currentCategoryId, search, onClickTemplateCardHandler, className, isFeatured } = props;
  const { t } = useTranslation(['common']);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.publishedTemplateList(currentCategoryId, search, isFeatured),
    queryFn: ({ pageParam }) =>
      getPublishedTemplateList({
        categoryId: currentCategoryId,
        search,
        skip: pageParam,
        take: PAGE_SIZE,
        featured: isFeatured,
      }).then((res) => res.data),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) {
        return undefined;
      }
      return allPages.length * PAGE_SIZE;
    },
  });

  const currentTemplateList = useMemo(() => {
    return data?.pages?.flatMap((page) => page) ?? [];
  }, [data]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div
        className={cn('grid grid-cols-1 gap-5 text-left sm:grid-cols-2 lg:grid-cols-3', className, {
          'grid-cols-1 sm:grid-cols-1 lg:grid-cols-1 py-4 px-6': currentTemplateList?.length === 0,
        })}
      >
        {currentTemplateList?.map((template) => (
          <TemplateCard
            size="md"
            key={template.id}
            template={template}
            onClickTemplateCardHandler={onClickTemplateCardHandler}
          />
        ))}

        {currentTemplateList?.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">{t('common:noResult')}</p>
          </div>
        )}
      </div>

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="my-4 flex gap-2 px-4"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {t('common:actions.loadMore')}
            {isFetchingNextPage && <Spin className="size-4" />}
          </Button>
        </div>
      )}
    </div>
  );
};
