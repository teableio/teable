import { useQuery } from '@tanstack/react-query';
import type { ITableQuery } from '@teable/openapi';
import { DataSource, getFields } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useMemo } from 'react';
import { useBaseQueryData } from '../chart/hooks/useBaseQueryData';
import { ChartFactory } from '../core/factory/ChartFactory';
import { useLayout } from './useLayout';
import { useStorage } from './useStorage';

export const useChartOption = () => {
  const { storage } = useStorage();
  const { result } = useBaseQueryData() || {};
  const { dataSource, query } = storage;
  const { layout } = useLayout();

  const { data: fields = [], isLoading: isFieldsLoading } = useQuery({
    queryKey: ReactQueryKeys.fieldList((query as ITableQuery)?.tableId as string),
    queryFn: () => getFields((query as ITableQuery)?.tableId as string).then((res) => res.data),
    enabled: Boolean(dataSource === DataSource.Table && (query as ITableQuery)?.tableId),
    meta: { preventGlobalError: true },
  });

  return useMemo(() => {
    if (result?.length === 0) {
      return null;
    }

    if (!result || !layout || (dataSource === DataSource.Table && isFieldsLoading)) {
      return null;
    }

    if (
      dataSource === DataSource.Table &&
      Array.isArray((query as ITableQuery)?.seriesArray) &&
      (query as ITableQuery)?.seriesArray.length === 0
    ) {
      return null;
    }

    try {
      return ChartFactory.generateChartOptions(
        storage,
        result,
        dataSource === DataSource.Table ? fields : undefined,
        layout
      );
    } catch (error) {
      console.error('Failed to generate chart options:', error);
      return null;
    }
  }, [result, isFieldsLoading, layout, query, storage, dataSource, fields]);
};
