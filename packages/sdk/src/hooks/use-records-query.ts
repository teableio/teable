import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FieldKeyType, type IRecord } from '@teable/core';
import type { IGetRecordsRo, IRecordsVo, IShareViewRecordsRo } from '@teable/openapi';
import { getRecords, getShareViewRecords } from '@teable/openapi';
import { useContext, useMemo } from 'react';
import { ReactQueryKeys } from '../config/react-query-keys';
import { ShareViewContext } from '../context/table/ShareViewContext';
import { createRecordInstance } from '../model';
import { useSearch } from './use-search';
import { useTableId } from './use-table-id';
import { useViewId } from './use-view-id';

export const useRecordsQuery = (query?: IGetRecordsRo, enabled = true) => {
  const tableId = useTableId();
  const viewId = useViewId();
  const { searchQuery } = useSearch();
  // Share contexts must route REST reads through /api/share/:shareId/view/*
  // so the server can apply view-level scope (visible fields, view filter,
  // hidden records). The PermissionGuard rejects common GETs that carry the
  // share-view header, so this branch is required — not just preferred.
  const { shareId } = useContext(ShareViewContext);

  const queryParams = useMemo(() => {
    return {
      viewId,
      search: searchQuery,
      fieldKeyType: FieldKeyType.Id,
      ...query,
    };
  }, [query, searchQuery, viewId]);

  // share-view endpoint binds viewId via the shareId, so strip the duplicate.
  const shareQueryParams = useMemo<IShareViewRecordsRo>(() => {
    const { viewId: _viewId, ...rest } = queryParams;
    return rest as IShareViewRecordsRo;
  }, [queryParams]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ReactQueryKeys.linkEditorRecords(shareId ?? tableId!, queryParams),
    queryFn: () =>
      shareId
        ? getShareViewRecords(shareId, shareQueryParams).then(({ data }) => data)
        : getRecords(tableId!, queryParams).then(({ data }) => data),
    enabled: Boolean((shareId || tableId) && enabled),
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
