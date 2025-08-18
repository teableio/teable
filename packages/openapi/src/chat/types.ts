import { recordSchema } from '@teable/core';
import { fieldKeyTypeRoSchema, recordInsertOrderRoSchema, typecastSchema } from '../record';
import { z } from '../zod';

export enum McpToolInvocationName {
  GetDeleteTablesParams = 'get-delete-tables-params',
  GetTableViews = 'get-table-views',
  GetTableFields = 'get-table-fields',
  GetUpdateRecordsParams = 'get-update-records-params',
  GetUpdateFieldsParams = 'get-update-fields-params',
  GetDeleteFieldsParams = 'get-delete-fields-params',
  GetTablesMeta = 'get-tables-meta',
  GetRecords = 'get-records',
  SqlQuery = 'sql-query',
  GenerateScriptAction = 'generate-script-action',
  GetScriptInput = 'get-script-input',
  GetTeableApi = 'get-teable-api',

  CreateTable = 'create-table',
  CreateView = 'create-view',
  CreateField = 'create-field',
  CreateRecords = 'create-records',
  CreateFields = 'create-fields',
  CreateViews = 'create-views',

  RunScripts = 'run-scripts',

  UpdateTableName = 'update-table-name',
  UpdateView = 'update-view',
  UpdateField = 'update-field',
  UpdateRecords = 'update-records',
  UpdateViewName = 'update-view-name',

  DeleteTable = 'delete-tables',
  DeleteView = 'delete-views',
  DeleteFields = 'delete-fields',
  DeleteRecords = 'delete-records',
}

export enum ChatToolInvocationName {
  Finish = 'finish',
}

export const chatContextSchema = z.object({
  tools: z.array(z.nativeEnum(McpToolInvocationName)).optional(),
  tables: z
    .array(
      z.object({
        id: z.string(),
        viewId: z.string().optional(),
      })
    )
    .optional(),
  workflowId: z.string().optional(),
  actionId: z.string().optional(),
});

export type IChatContext = z.infer<typeof chatContextSchema>;

export type IChatMessageUsage = {
  promptTokens: number;
  completionTokens: number;
  credit?: number;
};

export const deleteRecordsToolParamsSchema = z.object({
  tableId: z.string().describe('The table id to delete records from'),
  recordIds: z.array(z.string().startsWith('rec')).describe('The record ids to delete'),
});

export type IDeleteRecordsToolParams = z.infer<typeof deleteRecordsToolParamsSchema>;

export const updateRecordsToolParamsSchema = z.object({
  tableId: z.string().describe('The table id to create the field in'),
  updateRecordsRo: z
    .object({
      fieldKeyType: fieldKeyTypeRoSchema,
      typecast: typecastSchema,
      records: z.array(
        z.object({
          id: z.string().startsWith('rec').describe('The record id to update'),
          fields: recordSchema.shape.fields,
        })
      ),
      order: recordInsertOrderRoSchema.optional(),
    })
    .openapi({
      description: 'update one or multiple records',
    }),
});

export type IUpdateRecordsToolParams = z.infer<typeof updateRecordsToolParamsSchema>;
