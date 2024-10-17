import type { QueryFunctionContext } from '@tanstack/react-query';
import { getShareViewLinkRecords } from '@teable/openapi';
import { ApiRecordList } from '@teable/sdk/components';
import type { IFilterLinkSelectListProps } from '@teable/sdk/components/filter/view-filter/component/filter-link/types';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ShareViewContext } from '@teable/sdk/context';
import { useCallback, useContext, useState } from 'react';

const pageSize = 50;
export const StorageSelected: Record<string, string | undefined> = {};

export const FilterLinkSelectList = (props: IFilterLinkSelectListProps) => {
  const { shareId } = useContext(ShareViewContext);
  const { field, value, onClick } = props;

  const [search, setSearch] = useState<string>();

  const queryFn = useCallback(async ({ pageParam = 0, queryKey }: QueryFunctionContext) => {
    const res = await getShareViewLinkRecords(queryKey[1] as string, {
      fieldId: queryKey[2] as string,
      skip: pageParam * pageSize,
      take: pageSize,
      search: queryKey[3] as string,
    });
    return res.data;
  }, []);

  const selectedRecordIds = typeof value === 'string' ? [value] : value || undefined;

  return (
    <ApiRecordList
      queryKey={ReactQueryKeys.shareViewLinkRecords(shareId!, field.id, search)}
      pageSize={pageSize}
      selectedRecordIds={selectedRecordIds}
      queryFn={queryFn}
      onSearch={setSearch}
      onClick={({ id, title }) => {
        StorageSelected[id] = title;
        onClick(id);
      }}
    />
  );
};
