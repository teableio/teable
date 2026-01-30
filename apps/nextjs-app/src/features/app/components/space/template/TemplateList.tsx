import { useInfiniteQuery } from '@tanstack/react-query';
import { useTheme } from '@teable/next-themes';
import { getPublishedTemplateList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Spin } from '@teable/ui-lib/base';
import { Button, cn, Skeleton } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TemplateCard } from './TemplateCard';
import type { ITemplateBaseProps } from './TemplateMain';

const TemplateCardSkeleton = () => (
  <div className="flex w-full shrink-0 flex-col">
    <Skeleton className="aspect-[16/9] w-full rounded-lg" />
    <div className="flex flex-col gap-1 px-1 pt-2">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-12" />
      </div>
      <Skeleton className="h-4 w-full" />
    </div>
  </div>
);

interface ITemplateListProps extends ITemplateBaseProps {
  currentCategoryId: string | null;
  search: string;
  className?: string;
  isFeatured: boolean | undefined;
}

const PAGE_SIZE = 2 * 3 * 2;

export const TemplateList = (props: ITemplateListProps) => {
  const { currentCategoryId, search, onClickTemplateCardHandler, className, isFeatured } = props;
  const { t } = useTranslation(['common', 'space']);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
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

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div
          className={cn(
            'grid grid-cols-1 gap-5 text-left sm:grid-cols-2 lg:grid-cols-3',
            className
          )}
        >
          {Array.from({ length: 9 }).map((_, index) => (
            <TemplateCardSkeleton key={index} />
          ))}
        </div>
      </div>
    );
  }

  if (currentTemplateList?.length === 0) {
    return (
      <div className="flex size-full flex-1 flex-col items-center justify-center gap-4">
        <Image
          src={
            isDark ? '/images/layout/empty-list-dark.png' : '/images/layout/empty-list-light.png'
          }
          alt="No templates available"
          width={240}
          height={240}
        />
        <div className="flex flex-col items-center justify-center gap-2">
          <p className="text-base font-semibold text-foreground">
            {t('space:template.noTemplatesAvailable')}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('space:template.noTemplatesDescription')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div
        className={cn('grid grid-cols-1 gap-5 text-left sm:grid-cols-2 lg:grid-cols-3', className)}
      >
        {currentTemplateList?.map((template) => (
          <TemplateCard
            size="md"
            key={template.id}
            template={template}
            onClickTemplateCardHandler={onClickTemplateCardHandler}
          />
        ))}
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
