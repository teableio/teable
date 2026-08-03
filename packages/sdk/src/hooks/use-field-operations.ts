import { useMutation } from '@tanstack/react-query';
import type { IFieldRo } from '@teable/core';
import type { IAutoFillFieldRo } from '@teable/openapi';
import {
  convertField as convertFieldApi,
  createField as createFieldApi,
  planFieldCreate as planFieldCreateApi,
  planFieldConvert as planFieldConvertApi,
  deleteField as deleteFieldApi,
  autoFillField as autoFillFieldApi,
} from '@teable/openapi';

export const useFieldOperations = () => {
  const { mutateAsync: convertField } = useMutation({
    mutationFn: ({
      tableId,
      fieldId,
      fieldRo,
    }: {
      tableId: string;
      fieldId: string;
      fieldRo: IFieldRo;
    }) => convertFieldApi(tableId, fieldId, fieldRo).then((res) => res.data),
  });

  const { mutateAsync: createField } = useMutation({
    mutationFn: ({ tableId, fieldRo }: { tableId: string; fieldRo: IFieldRo }) =>
      createFieldApi(tableId, fieldRo).then((res) => res.data),
  });

  const { mutateAsync: planFieldCreate } = useMutation({
    mutationFn: ({ tableId, fieldRo }: { tableId: string; fieldRo: IFieldRo }) =>
      planFieldCreateApi(tableId, fieldRo).then((res) => res.data),
  });

  const { mutateAsync: planFieldConvert } = useMutation({
    mutationFn: ({
      tableId,
      fieldId,
      fieldRo,
    }: {
      tableId: string;
      fieldId: string;
      fieldRo: IFieldRo;
    }) => planFieldConvertApi(tableId, fieldId, fieldRo).then((res) => res.data),
  });

  const { mutateAsync: deleteField } = useMutation({
    mutationFn: ({ tableId, fieldId }: { tableId: string; fieldId: string }) =>
      deleteFieldApi(tableId, fieldId).then((res) => res.data),
  });

  const { mutateAsync: autoFillField } = useMutation({
    mutationFn: ({
      tableId,
      fieldId,
      query,
    }: {
      tableId: string;
      fieldId: string;
      query: IAutoFillFieldRo;
    }) => autoFillFieldApi(tableId, fieldId, query).then((res) => res.data),
  });

  return {
    createField,
    convertField,
    planFieldCreate,
    planFieldConvert,
    deleteField,
    autoFillField,
  };
};
