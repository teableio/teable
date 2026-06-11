import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FieldKeyType, type IRecord } from '@teable/core';
import type { IGetRecordsRo, IRecordsVo, IShareViewRecordsRo } from '@teable/openapi';
import { getShareViewRecords } from '@teable/openapi';
import { useContext, useMemo } from 'react';
import { ReactQueryKeys } from '../config/react-query-keys';
import { ShareViewContext } from '../context/table/ShareViewContext';
import { createRecordInstance } from '../model';
import { useSearch } from './use-search';

export const useRecordsQuery = (query?: IGetRecordsRo, enabled = true) => {
  const { searchQuery } = useSearch();
  // This hook only powers the link editor record list (LinkList), which always
  // renders inside a LinkViewProvider, so ShareViewContext.shareId is always set
  // (=== linkFieldId) and reads always go through the share-view endpoint. The
  // share-view endpoint binds viewId via the shareId, so the client viewId is stripped.
  const { shareId } = useContext(ShareViewContext);

  const shareQueryParams = useMemo<IShareViewRecordsRo>(() => {
    const { viewId: _viewId, ...rest } = {
      search: searchQuery,
      fieldKeyType: FieldKeyType.Id,
      ...query,
    };
    return rest as IShareViewRecordsRo;
  }, [query, searchQuery]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ReactQueryKeys.linkEditorRecords(shareId, shareQueryParams),
    queryFn: () => getShareViewRecords(shareId, shareQueryParams).then(({ data }) => data),
    enabled: Boolean(shareId && enabled),
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
