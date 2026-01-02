import { oc } from '@orpc/contract';
import {
  createFieldInputSchema,
  createRecordInputSchema,
  createRecordsInputSchema,
  createTableInputSchema,
  deleteFieldInputSchema,
  deleteTableInputSchema,
  getTableByIdInputSchema,
  listTableRecordsInputSchema,
  listTablesInputSchema,
  renameTableInputSchema,
} from '@teable/v2-core';

import { createFieldOkResponseSchema } from './table/createField';
import { createRecordOkResponseSchema } from './table/createRecord';
import { createRecordsOkResponseSchema } from './table/createRecords';
import { createTableErrorResponseSchema, createTableOkResponseSchema } from './table/createTable';
import { deleteFieldOkResponseSchema } from './table/deleteField';
import { deleteTableErrorResponseSchema, deleteTableOkResponseSchema } from './table/deleteTable';
import { getTableByIdOkResponseSchema } from './table/getTableById';
import { listTableRecordsOkResponseSchema } from './table/listTableRecords';
import { listTablesOkResponseSchema } from './table/listTables';
import { renameTableOkResponseSchema } from './table/renameTable';

const TABLES_CREATE_FIELD_PATH = '/tables/createField';
const TABLES_CREATE_PATH = '/tables/create';
const TABLES_CREATE_RECORD_PATH = '/tables/createRecord';
const TABLES_CREATE_RECORDS_PATH = '/tables/createRecords';
const TABLES_DELETE_FIELD_PATH = '/tables/deleteField';
const TABLES_DELETE_PATH = '/tables/delete';
const TABLES_GET_PATH = '/tables/get';
const TABLES_LIST_RECORDS_PATH = '/tables/listRecords';
const TABLES_LIST_PATH = '/tables/list';
const TABLES_RENAME_PATH = '/tables/rename';

export const v2Contract = {
  tables: {
    create: oc
      .route({
        method: 'POST',
        path: TABLES_CREATE_PATH,
        successStatus: 201,
        summary: 'Create table',
        tags: ['tables'],
      })
      .input(createTableInputSchema)
      .output(createTableOkResponseSchema),
    createField: oc
      .route({
        method: 'POST',
        path: TABLES_CREATE_FIELD_PATH,
        successStatus: 200,
        summary: 'Create field',
        tags: ['tables'],
      })
      .input(createFieldInputSchema)
      .output(createFieldOkResponseSchema),
    createRecord: oc
      .route({
        method: 'POST',
        path: TABLES_CREATE_RECORD_PATH,
        successStatus: 201,
        summary: 'Create record',
        tags: ['tables'],
      })
      .input(createRecordInputSchema)
      .output(createRecordOkResponseSchema),
    createRecords: oc
      .route({
        method: 'POST',
        path: TABLES_CREATE_RECORDS_PATH,
        successStatus: 201,
        summary: 'Create multiple records',
        tags: ['tables'],
      })
      .input(createRecordsInputSchema)
      .output(createRecordsOkResponseSchema),
    deleteField: oc
      .route({
        method: 'DELETE',
        path: TABLES_DELETE_FIELD_PATH,
        successStatus: 200,
        summary: 'Delete field',
        tags: ['tables'],
      })
      .input(deleteFieldInputSchema)
      .output(deleteFieldOkResponseSchema),
    delete: oc
      .route({
        method: 'DELETE',
        path: TABLES_DELETE_PATH,
        successStatus: 200,
        summary: 'Delete table',
        tags: ['tables'],
      })
      .input(deleteTableInputSchema)
      .output(deleteTableOkResponseSchema),
    getById: oc
      .route({
        method: 'GET',
        path: TABLES_GET_PATH,
        successStatus: 200,
        summary: 'Get table by id',
        tags: ['tables'],
      })
      .input(getTableByIdInputSchema)
      .output(getTableByIdOkResponseSchema),
    listRecords: oc
      .route({
        method: 'GET',
        path: TABLES_LIST_RECORDS_PATH,
        successStatus: 200,
        summary: 'List table records',
        tags: ['tables'],
      })
      .input(listTableRecordsInputSchema)
      .output(listTableRecordsOkResponseSchema),
    list: oc
      .route({
        method: 'GET',
        path: TABLES_LIST_PATH,
        successStatus: 200,
        summary: 'List tables',
        tags: ['tables'],
      })
      .input(listTablesInputSchema)
      .output(listTablesOkResponseSchema),
    rename: oc
      .route({
        method: 'POST',
        path: TABLES_RENAME_PATH,
        successStatus: 200,
        summary: 'Rename table',
        tags: ['tables'],
      })
      .input(renameTableInputSchema)
      .output(renameTableOkResponseSchema),
  },
} as const;

export const v2ContractErrors = {
  400: createTableErrorResponseSchema,
  404: deleteTableErrorResponseSchema,
  500: createTableErrorResponseSchema,
} as const;
