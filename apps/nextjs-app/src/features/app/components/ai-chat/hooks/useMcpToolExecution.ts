import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IConvertFieldRo, IViewVo } from '@teable/core';
import type { ITableNameRo, ITableVo, IUpdateRecordsRo, IViewNameRo } from '@teable/openapi';
import {
  convertField,
  deleteFields,
  deleteRecords,
  deleteTable,
  deleteView,
  McpToolInvocationName,
  updateRecords,
  updateTableName,
  updateViewName,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useTableId, useTables } from '@teable/sdk/hooks';
import { pick } from 'lodash';
import router from 'next/router';
import { useCallback } from 'react';

export const useMcpToolExecution = () => {
  const queryClient = useQueryClient();

  const baseId = useBaseId();

  const tableId = useTableId();

  const tables = useTables();

  const callBack = useCallback(
    (toolName: McpToolInvocationName, result: unknown, args: unknown) => {
      switch (toolName) {
        case McpToolInvocationName.CreateField:
        case McpToolInvocationName.CreateRecords: {
          const { tableId: newTableId } = args as {
            tableId: string;
          };
          if (tableId !== newTableId) {
            router.push(
              {
                pathname: `/base/[baseId]/[tableId]/`,
                query: {
                  baseId,
                  tableId: newTableId,
                },
              },
              undefined,
              {
                shallow: Boolean(tableId),
              }
            );
          }
          break;
        }
        case McpToolInvocationName.CreateView: {
          const { tableId: newTableId } = args as {
            tableId: string;
          };
          const { id: newViewId } = result as IViewVo;
          if (tableId !== newTableId) {
            router.push(
              {
                pathname: `/base/[baseId]/[tableId]/[viewId]`,
                query: {
                  baseId,
                  tableId: newTableId,
                  viewId: newViewId,
                },
              },
              undefined,
              {
                shallow: Boolean(tableId),
              }
            );
          }
          break;
        }
        case McpToolInvocationName.CreateTable:
          {
            const res = result as ITableVo;
            const newTableId = res.id;
            if (tableId !== newTableId) {
              router.push(
                {
                  pathname: `/base/[baseId]/[tableId]/`,
                  query: {
                    baseId,
                    tableId: newTableId,
                  },
                },
                undefined,
                {
                  shallow: Boolean(tableId),
                }
              );
            }
          }
          break;
        default:
          break;
      }
    },
    [baseId, tableId]
  );

  const { mutateAsync: convertFieldMutate } = useMutation({
    mutationFn: ({
      tableId,
      fieldId,
      fieldRo,
    }: {
      tableId: string;
      fieldId: string;
      fieldRo: IConvertFieldRo;
    }) => convertField(tableId, fieldId, fieldRo),
    onSuccess: (_, query) => {
      queryClient.invalidateQueries(ReactQueryKeys.fieldList(query.tableId));
    },
  });

  const { mutateAsync: deleteFieldsMutate } = useMutation({
    mutationFn: ({ tableId, fieldIds }: { tableId: string; fieldIds: string[] }) =>
      deleteFields(tableId, fieldIds),
    onSuccess: (_, query) => {
      queryClient.invalidateQueries(ReactQueryKeys.fieldList(query.tableId));
    },
  });

  const { mutateAsync: updateRecordsMutate } = useMutation({
    mutationFn: ({
      tableId,
      updateRecordsRo,
    }: {
      tableId: string;
      updateRecordsRo: IUpdateRecordsRo;
    }) => updateRecords(tableId, updateRecordsRo),
  });

  const { mutateAsync: updateViewNameMutate } = useMutation({
    mutationFn: ({
      tableId,
      viewId,
      updateViewNameRo,
    }: {
      tableId: string;
      viewId: string;
      updateViewNameRo: IViewNameRo;
    }) => updateViewName(tableId, viewId, updateViewNameRo),
  });

  const { mutateAsync: updateTableNameMutate } = useMutation({
    mutationFn: ({
      baseId,
      tableId,
      updateTableNameRo,
    }: {
      baseId: string;
      tableId: string;
      updateTableNameRo: ITableNameRo;
    }) => updateTableName(baseId, tableId, updateTableNameRo),
  });

  const { mutateAsync: deleteTableMutate } = useMutation({
    mutationFn: ({ tableId, baseId }: { baseId: string; tableId: string }) =>
      deleteTable(baseId, tableId),
  });

  const { mutateAsync: deleteRecordsMutate } = useMutation({
    mutationFn: ({ tableId, recordIds }: { tableId: string; recordIds: string[] }) =>
      deleteRecords(tableId, recordIds),
  });

  const { mutateAsync: deleteViewsMutate } = useMutation({
    mutationFn: ({ tableId, viewId }: { tableId: string; viewId: string }) =>
      deleteView(tableId, viewId),
  });

  if (!baseId) {
    return {} as Record<
      string,
      {
        execute: (params: unknown) => Promise<unknown>;
        callBack: (result: unknown, args: unknown) => void;
      }
    >;
  }

  return {
    [McpToolInvocationName.UpdateField]: {
      execute: async (params: unknown) => {
        const { tableId, fieldId, updateFieldRo } = params as {
          tableId: string;
          fieldId: string;
          updateFieldRo: IConvertFieldRo;
        };
        return (
          await convertFieldMutate({
            tableId,
            fieldId,
            fieldRo: updateFieldRo,
          })
        ).data;
      },
      callBack: (result: unknown, args: unknown) => {
        callBack(McpToolInvocationName.UpdateField, result, args);
      },
    },
    [McpToolInvocationName.UpdateRecords]: {
      execute: async (params: unknown) => {
        const { tableId, updateRecordsRo } = params as {
          tableId: string;
          updateRecordsRo: IUpdateRecordsRo;
        };
        return (await updateRecordsMutate({ tableId, updateRecordsRo })).data;
      },
      callBack: (result: unknown, args: unknown) => {
        callBack(McpToolInvocationName.UpdateRecords, result, args);
      },
    },
    [McpToolInvocationName.UpdateViewName]: {
      execute: async (params: unknown) => {
        const { tableId, updateViewNameRo, viewId } = params as {
          tableId: string;
          viewId: string;
          updateViewNameRo: { name: string };
        };

        return (
          await updateViewNameMutate({
            tableId,
            viewId,
            updateViewNameRo,
          })
        ).data;
      },
      callBack: (result: unknown, args: unknown) => {
        callBack(McpToolInvocationName.UpdateViewName, result, args);
      },
    },
    [McpToolInvocationName.UpdateTableName]: {
      execute: async (params: unknown) => {
        const { tableId, updateTableNameRo } = params as {
          tableId: string;
          updateTableNameRo: { name: string };
        };
        return (
          await updateTableNameMutate({
            tableId,
            baseId,
            updateTableNameRo,
          })
        ).data;
      },
      callBack: (result: unknown, args: unknown) => {
        callBack(McpToolInvocationName.UpdateViewName, result, args);
      },
    },
    [McpToolInvocationName.DeleteRecords]: {
      execute: async (params: unknown) => {
        const { tableId, recordIds } = params as {
          tableId: string;
          recordIds: string[];
        };
        return (await deleteRecordsMutate({ tableId, recordIds })).data;
      },
      callBack: (result: unknown, args: unknown) => {
        callBack(McpToolInvocationName.DeleteFields, result, args);
      },
    },
    [McpToolInvocationName.DeleteFields]: {
      execute: async (params: unknown) => {
        const { tableId, fieldIds } = params as {
          tableId: string;
          fieldIds: string[];
        };
        return (await deleteFieldsMutate({ tableId, fieldIds })).data;
      },
      callBack: (result: unknown, args: unknown) => {
        callBack(McpToolInvocationName.DeleteFields, result, args);
      },
    },
    [McpToolInvocationName.DeleteTable]: {
      execute: async (params: unknown) => {
        const { baseId, tableId } = params as {
          baseId: string;
          tableId: string;
        };
        const deletedTable = tables.find((table) => table.id === tableId);
        await deleteTableMutate({ baseId, tableId });
        return pick(deletedTable, ['id', 'name', 'icon', 'order']);
      },
      callBack: (result: unknown, args: unknown) => {
        callBack(McpToolInvocationName.DeleteTable, result, args);
      },
    },
    [McpToolInvocationName.DeleteView]: {
      execute: async (params: unknown) => {
        const { tableId, viewId } = params as {
          tableId: string;
          viewId: string;
        };
        return (await deleteViewsMutate({ tableId, viewId })).data;
      },
      callBack: (result: unknown, args: unknown) => {
        callBack(McpToolInvocationName.DeleteView, result, args);
      },
    },
  } as Record<
    string,
    {
      execute: (params: unknown) => Promise<unknown>;
      callBack: (result: unknown, args: unknown) => void;
    }
  >;
};
