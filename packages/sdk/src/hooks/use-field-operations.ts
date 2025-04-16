import { useQueryClient } from '@tanstack/react-query';
import type { IFieldRo } from '@teable/core';
import {
  convertField as convertFieldApi,
  createField as createFieldApi,
  planFieldCreate as planFieldCreateApi,
  planFieldConvert as planFieldConvertApi,
  deleteField as deleteFieldApi,
} from '@teable/openapi';
import { ReactQueryKeys } from '../config';

export const useFieldOperations = () => {
  const queryClient = useQueryClient();

  const convertField = async (tableId: string, fieldId: string, fieldRo: IFieldRo) => {
    return queryClient.ensureQueryData({
      queryKey: ReactQueryKeys.convertField(tableId, fieldId, fieldRo),
      queryFn: async ({ queryKey }) => convertFieldApi(queryKey[1], queryKey[2], queryKey[3]),
    });
  };

  const createField = async (tableId: string, fieldRo: IFieldRo) => {
    return queryClient.ensureQueryData({
      queryKey: ReactQueryKeys.createField(tableId, fieldRo),
      queryFn: async ({ queryKey }) => createFieldApi(queryKey[1], queryKey[2]),
    });
  };

  const planFieldCreate = async (tableId: string, fieldRo: IFieldRo) => {
    return queryClient.ensureQueryData({
      queryKey: ReactQueryKeys.planFieldCreate(tableId, fieldRo),
      queryFn: async ({ queryKey }) => planFieldCreateApi(queryKey[1], queryKey[2]),
    });
  };

  const planFieldConvert = async (tableId: string, fieldId: string, fieldRo: IFieldRo) => {
    return queryClient.ensureQueryData({
      queryKey: ReactQueryKeys.planFieldConvert(tableId, fieldId, fieldRo),
      queryFn: async ({ queryKey }) => planFieldConvertApi(queryKey[1], queryKey[2], queryKey[3]),
    });
  };

  const deleteField = async (tableId: string, fieldId: string) => {
    return queryClient.ensureQueryData({
      queryKey: ReactQueryKeys.deleteField(tableId, fieldId),
      queryFn: async ({ queryKey }) => deleteFieldApi(queryKey[1], queryKey[2]),
    });
  };

  return { createField, convertField, planFieldCreate, planFieldConvert, deleteField };
};
