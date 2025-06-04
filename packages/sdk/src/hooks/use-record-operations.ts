import { useQueryClient } from '@tanstack/react-query';
import type {
  ICreateRecordsRo,
  IRecordInsertOrderRo,
  IUpdateRecordOrdersRo,
  IUpdateRecordRo,
  IUpdateRecordsRo,
} from '@teable/openapi';
import {
  createRecords as createRecordsApi,
  updateRecord as updateRecordApi,
  updateRecords as updateRecordsApi,
  duplicateRecord as duplicateRecordApi,
  updateRecordOrders as updateRecordOrdersApi,
} from '@teable/openapi';
import { ReactQueryKeys } from '../config';

export const useRecordOperations = () => {
  const queryClient = useQueryClient();

  const createRecords = async (tableId: string, recordsRo: ICreateRecordsRo) => {
    return queryClient.ensureQueryData({
      queryKey: ReactQueryKeys.createRecords(tableId, recordsRo),
      queryFn: async ({ queryKey }) => createRecordsApi(queryKey[1], queryKey[2]),
    });
  };

  const updateRecord = async (tableId: string, recordId: string, recordRo: IUpdateRecordRo) => {
    return queryClient.ensureQueryData({
      queryKey: ReactQueryKeys.updateRecord(tableId, recordId, recordRo),
      queryFn: async ({ queryKey }) => updateRecordApi(queryKey[1], queryKey[2], queryKey[3]),
    });
  };

  const updateRecords = async (tableId: string, recordsRo: IUpdateRecordsRo) => {
    return queryClient.ensureQueryData({
      queryKey: ReactQueryKeys.updateRecords(tableId, recordsRo),
      queryFn: async ({ queryKey }) => updateRecordsApi(queryKey[1], queryKey[2]),
    });
  };

  const duplicateRecord = async (
    tableId: string,
    recordId: string,
    order: IRecordInsertOrderRo
  ) => {
    return queryClient.ensureQueryData({
      queryKey: ReactQueryKeys.duplicateRecord(tableId, recordId, order),
      queryFn: async ({ queryKey }) => duplicateRecordApi(queryKey[1], queryKey[2], queryKey[3]),
      cacheTime: 0,
    });
  };

  const updateRecordOrders = async (
    tableId: string,
    viewId: string,
    order: IUpdateRecordOrdersRo
  ) => {
    return queryClient.ensureQueryData({
      queryKey: ReactQueryKeys.updateRecordOrders(tableId, viewId, order),
      queryFn: async ({ queryKey }) => updateRecordOrdersApi(queryKey[1], queryKey[2], queryKey[3]),
    });
  };

  return { createRecords, updateRecord, updateRecords, duplicateRecord, updateRecordOrders };
};
