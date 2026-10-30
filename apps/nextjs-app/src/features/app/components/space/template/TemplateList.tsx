import { useInfiniteQuery } from '@tanstack/react-query';
import { TemplateListSort, getPublishedTemplateList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTheme } from '@teable/ui-lib';
import { Spin } from '@teable/ui-lib/base';
import { Button, cn, Skeleton } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TemplateCard } from './TemplateCard';
import type { ITemplateBaseProps, ITemplateListing } from './TemplateMain';

const TemplateCardSkeleton = () => (
  <div className="flex w-full shrink-0 flex-col">
    <Skeleton className="aspect-[16/9] w-full rounded-lg" />
    <div className="flex flex-col gap-1 px-1 pt-2">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  </div>
);

const LISTINGS: ITemplateListing[] = ['featured', 'newest'];

interface ITemplateListProps extends ITemplateBaseProps {
  currentCategoryId: string | null;
  search: string;
  className?: string;
  isFeatured: boolean | undefined;
  sort: TemplateListSort | undefined;
  listing: ITemplateListing;
  onListingChange: (listing: ITemplateListing) => void;
}

const PAGE_SIZE = 2 * 3 * 2;

// The dialog tops out at 80rem outside its 1px borders, so the fourth column must come before 80rem.
const GRID = 'grid grid-cols-1 gap-5 text-start @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4';

export const TemplateList = (props: ITemplateListProps) => {
  const {
    currentCategoryId,
    search,
    onClickTemplateCardHandler,
    className,
    isFeatured,
    sort,
    listing,
    onListingChange,
  } = props;
  const { t } = useTranslation(['common', 'space']);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: [
      ...ReactQueryKeys.publishedTemplateList(currentCategoryId, search, isFeatured),
      sort ?? '',
    ],
    queryFn: ({ pageParam }) =>
      getPublishedTemplateList({
        categoryId: currentCategoryId,
        search,
        skip: pageParam,
        take: PAGE_SIZE,
        featured: isFeatured,
        sort,
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
    return data?.pages?.flat() ?? [];
  }, [data]);
  // The ranked listing, unfiltered, is the ranking itself: its first ten carry their place.
  const ranked = sort === TemplateListSort.Ranking && !search && !currentCategoryId;

  const listingBar = (
    <div className="flex shrink-0 items-center gap-1.5 px-4 pt-4">
      {LISTINGS.map((item) => (
        <Button
          key={item}
          size="xs"
          variant={listing === item ? 'default' : 'outline'}
          className="rounded-full"
          onClick={() => onListingChange(item)}
        >
          {t(`common:template.listing.${item}`)}
        </Button>
      ))}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        {listingBar}
        <div className={cn(GRID, className)}>
          {Array.from({ length: 9 }).map((_, index) => (
            <TemplateCardSkeleton key={index} />
          ))}
        </div>
      </div>
    );
  }

  if (currentTemplateList?.length === 0) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        {listingBar}
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
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
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {listingBar}
      <div className={cn(GRID, className)}>
        {currentTemplateList?.map((template, index) => (
          <TemplateCard
            size="md"
            key={template.id}
            template={template}
            rank={ranked && index < 10 ? index + 1 : undefined}
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
