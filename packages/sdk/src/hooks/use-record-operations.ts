import { useMutation } from '@tanstack/react-query';
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

export const useRecordOperations = () => {
  const { mutateAsync: createRecords } = useMutation({
    mutationFn: ({ tableId, recordsRo }: { tableId: string; recordsRo: ICreateRecordsRo }) =>
      createRecordsApi(tableId, recordsRo),
  });

  const { mutateAsync: updateRecord } = useMutation({
    mutationFn: ({
      tableId,
      recordId,
      recordRo,
    }: {
      tableId: string;
      recordId: string;
      recordRo: IUpdateRecordRo;
    }) => updateRecordApi(tableId, recordId, recordRo),
  });

  const { mutateAsync: updateRecords } = useMutation({
    mutationFn: ({ tableId, recordsRo }: { tableId: string; recordsRo: IUpdateRecordsRo }) =>
      updateRecordsApi(tableId, recordsRo),
  });

  const { mutateAsync: duplicateRecord } = useMutation({
    mutationFn: ({
      tableId,
      recordId,
      order,
    }: {
      tableId: string;
      recordId: string;
      order: IRecordInsertOrderRo;
    }) => duplicateRecordApi(tableId, recordId, order),
  });

  const { mutateAsync: updateRecordOrders } = useMutation({
    mutationFn: ({
      tableId,
      viewId,
      order,
    }: {
      tableId: string;
      viewId: string;
      order: IUpdateRecordOrdersRo;
    }) => updateRecordOrdersApi(tableId, viewId, order),
  });

  return { createRecords, updateRecord, updateRecords, duplicateRecord, updateRecordOrders };
};
