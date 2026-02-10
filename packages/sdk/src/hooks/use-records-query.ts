import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FieldKeyType, type IRecord } from '@teable/core';
import type { IGetRecordsRo, IRecordsVo } from '@teable/openapi';
import { getRecords } from '@teable/openapi';
import { useMemo } from 'react';
import { ReactQueryKeys } from '../config/react-query-keys';
import { createRecordInstance } from '../model';
import { useSearch } from './use-search';
import { useTableId } from './use-table-id';
import { useViewId } from './use-view-id';

export const useRecordsQuery = (query?: IGetRecordsRo, enabled = true) => {
  const tableId = useTableId();
  const viewId = useViewId();
  const { searchQuery } = useSearch();

  const queryParams = useMemo(() => {
    return {
      viewId,
      search: searchQuery,
      fieldKeyType: FieldKeyType.Id,
      ...query,
    };
  }, [query, searchQuery, viewId]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ReactQueryKeys.linkEditorRecords(tableId!, queryParams),
    queryFn: () => getRecords(tableId!, queryParams).then(({ data }) => data),
    enabled: Boolean(tableId && enabled),
    placeholderData: keepPreviousData,
  });

  return useMemo(() => {
    const records = (data?.records ?? []).map((record: IRecord) => {
      const instance = createRecordInstance(record);
      instance.getCellValue = (fieldId: string) => {
        return record.fields[fieldId];
      };
      return instance;
    });

    return {
      records,
      extra: data?.extra as IRecordsVo['extra'],
      isLoading,
      isFetching,
    };
  }, [data, isLoading, isFetching]);
};
