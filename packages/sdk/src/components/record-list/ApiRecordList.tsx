import type { QueryFunction, QueryKey } from '@tanstack/react-query';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ILinkCellValue } from '@teable/core';
import { Button } from '@teable/ui-lib';
import { debounce } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { RecordItem } from './RecordItem';
import { RecordList } from './RecordList';
import { RecordSearch } from './RecordSearch';

interface IApiRecordListProps {
  queryKey: QueryKey;
  queryFn: QueryFunction<{ id: string; title?: string }[]>;
  selectedRecordIds?: string[];
  pageSize: number;
  onSearch?: (search?: string) => void;
  onClick?: (record: ILinkCellValue) => void;
  onSelected?: (record: ILinkCellValue) => void;
}

export const ApiRecordList = (props: IApiRecordListProps) => {
  const { queryFn, queryKey, onSearch, selectedRecordIds, pageSize, onClick, onSelected } = props;
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const updateSearchParam = useMemo(() => {
    return debounce((search?: string) => {
      return onSearch?.(search);
    }, 300);
  }, [onSearch]);

  useEffect(() => {
    if (!search) {
      return updateSearchParam(undefined);
    }
    updateSearchParam(search);
  }, [search, updateSearchParam]);

  const { status, data, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey,
    queryFn,
    staleTime: 1000,
    refetchOnWindowFocus: false,
    getNextPageParam: (lastPage, allPage) =>
      lastPage.length < pageSize ? undefined : allPage.length,
  });

  const allRows = data ? data.pages.flatMap((d) => d) : [];
  const rowCount = hasNextPage ? allRows.length + 1 : allRows.length;

  return (
    <RecordList
      className="h-full"
      onSelect={(index) => {
        const record = allRows[index];
        if (!record) {
          return;
        }
        if (!selectedRecordIds?.includes(record.id)) {
          onSelected?.(record);
        }
        onClick?.(record);
      }}
      itemRender={(index) => {
        const record = allRows[index];
        if (rowCount - 1 <= index && hasNextPage) {
          return (
            <Button size={'sm'} variant={'link'} className="mx-auto my-0.5">
              {t('common.loadMore')}
            </Button>
          );
        }
        const isActive = selectedRecordIds?.includes(record.id);
        return <RecordItem title={record.title} active={isActive} />;
      }}
      rowCount={rowCount}
      isLoading={status === 'loading'}
      onVisibleChange={(range) => {
        const [, endIndex] = range;
        if (rowCount - 1 <= endIndex && hasNextPage) {
          fetchNextPage();
        }
      }}
    >
      {onSearch && <RecordSearch value={search} onChange={(e) => setSearch(e.target.value)} />}
    </RecordList>
  );
};
