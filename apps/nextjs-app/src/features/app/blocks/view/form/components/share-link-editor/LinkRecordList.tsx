import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { contains } from '@teable/core';
import type { IFilter, ILinkCellValue } from '@teable/core';
import { getShareViewLinkRecords } from '@teable/openapi';
import { LinkCard } from '@teable/sdk/components';
import type { LinkField } from '@teable/sdk/model';
import {
  Button,
  Command,
  CommandItem,
  CommandList,
  Input,
  Separator,
  cn,
} from '@teable/ui-lib/shadcn';
import { debounce } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnmount } from 'react-use';
import { tableConfig } from '@/features/i18n/table.config';

interface ILinkRecordListProps {
  shareId: string;
  field: LinkField;
  selectedRecordIds?: string[];
  onSelected?: (record: ILinkCellValue) => void;
}

const pageSize = 50;

export const LinkRecordList = (props: ILinkRecordListProps) => {
  const { shareId, field, selectedRecordIds, onSelected } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<IFilter>();
  const fieldId = field.id;
  const { foreignTableId, lookupFieldId } = field.options;

  const updateFilter = useMemo(() => {
    return debounce((filter?: IFilter) => {
      return setFilter(filter);
    }, 300);
  }, []);

  useEffect(() => {
    if (!search) {
      return updateFilter(undefined);
    }
    updateFilter({
      filterSet: [
        {
          fieldId: lookupFieldId,
          value: search,
          operator: contains.value,
        },
      ],
      conjunction: 'and',
    });
  }, [search, lookupFieldId, updateFilter]);

  const queryKey = useMemo(
    () => ['share-link-records', shareId, foreignTableId, filter, fieldId],
    [fieldId, filter, foreignTableId, shareId]
  );

  const { status, data, isFetchingNextPage, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam = 0, queryKey }) => {
      const res = await getShareViewLinkRecords(queryKey[1] as string, {
        tableId: queryKey[2] as string,
        skip: pageParam * pageSize,
        take: pageSize,
        filter: queryKey[3] as IFilter,
        filterLinkCellCandidate: queryKey[4] as string,
      });
      return res.data;
    },
    refetchOnWindowFocus: false,
    getNextPageParam: (lastPage, allPage) =>
      lastPage.records.length < pageSize ? undefined : allPage.length,
  });

  useEffect(() => {
    return () => {
      queryClient.removeQueries(queryKey);
    };
  }, [queryClient, queryKey]);

  useUnmount(() => {
    queryClient.resetQueries(queryKey);
  });

  const isEmpty = !data?.pages?.[0].records?.length;

  return (
    <Command>
      <div className="relative p-0.5">
        <Input
          className="h-8"
          placeholder="Search record name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        ></Input>
      </div>
      <Separator className="my-2" />
      <CommandList>
        {status === 'loading' && <div className="text-center">{t('actions.loading')}</div>}
        {status === 'success' && isEmpty && <div className="text-center">{t('noResult')}</div>}
        {status === 'success' &&
          data.pages.map((page) => {
            return page.records.map(({ id, name }) => (
              <CommandItem
                key={id}
                value={id}
                onSelect={() => {
                  if (selectedRecordIds?.includes(id)) return;
                  onSelected?.({ id, title: name });
                }}
                className="relative"
              >
                <LinkCard
                  wrapClassName={cn('w-full truncate', {
                    'border-l-8 border-l-foreground': selectedRecordIds?.includes(id),
                  })}
                  className="truncate"
                  title={name?.replaceAll('\n', ' ')}
                  readonly
                />
              </CommandItem>
            ));
          })}
        {hasNextPage && !isEmpty && (
          <div className="text-center">
            <Button
              size={'sm'}
              variant={'link'}
              className="mx-auto my-0.5"
              onKeyDown={(e) => e.key === 'Enter' && fetchNextPage()}
              onClick={() => fetchNextPage()}
            >
              {isFetchingNextPage ? t('actions.loading') : t('actions.loadMore')}
            </Button>
          </div>
        )}
      </CommandList>
    </Command>
  );
};
