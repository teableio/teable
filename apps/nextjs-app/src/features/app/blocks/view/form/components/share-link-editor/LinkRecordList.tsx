import type { QueryFunctionContext } from '@tanstack/react-query';
import type { ILinkCellValue } from '@teable/core';
import { getShareViewLinkRecords } from '@teable/openapi';
import { ApiRecordList } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useCallback, useMemo, useState } from 'react';

interface ILinkRecordListProps {
  shareId: string;
  fieldId: string;
  selectedRecordIds?: string[];
  onSelected?: (record: ILinkCellValue) => void;
}

const pageSize = 50;

export const LinkRecordList = (props: ILinkRecordListProps) => {
  const { shareId, fieldId, selectedRecordIds, onSelected } = props;
  const [searchParam, setSearchParam] = useState<string>();

  const queryKey = useMemo(
    () => ReactQueryKeys.shareViewLinkRecords(shareId, fieldId, searchParam),
    [fieldId, searchParam, shareId]
  );

  const queryFn = useCallback(async ({ pageParam = 0, queryKey }: QueryFunctionContext) => {
    const res = await getShareViewLinkRecords(queryKey[1] as string, {
      fieldId: queryKey[2] as string,
      skip: pageParam * pageSize,
      take: pageSize,
      search: queryKey[3] as string,
    });
    return res.data;
  }, []);

  return (
    <ApiRecordList
      queryKey={queryKey}
      pageSize={pageSize}
      selectedRecordIds={selectedRecordIds}
      queryFn={queryFn}
      onSearch={setSearchParam}
      onSelected={onSelected}
    />
  );
};
