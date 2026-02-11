import { oc } from '@orpc/contract';
import type { AnyContractRouter } from '@orpc/contract';
import {
  createBaseInputSchema,
  createFieldInputSchema,
  createRecordInputSchema,
  createRecordsInputSchema,
  submitRecordInputSchema,
  createTableInputSchema,
  createTablesInputSchema,
  deleteByRangeCommandInputSchema,
  deleteFieldInputSchema,
  deleteRecordsInputSchema,
  deleteTableInputSchema,
  duplicateRecordInputSchema,
  getRecordByIdInputSchema,
  getTableByIdInputSchema,
  importCsvInputSchema,
  importRecordsInputSchema,
  listBasesInputSchema,
  listTableRecordsInputSchema,
  listTablesInputSchema,
  pasteCommandInputSchema,
  clearCommandInputSchema,
  renameTableInputSchema,
  updateRecordInputSchema,
  reorderRecordsInputSchema,
} from '@teable/v2-core';

import { createBaseOkResponseSchema } from './base/createBase';
import { listBasesOkResponseSchema } from './base/listBases';
import { clearOkResponseSchema } from './table/clear';
import { createFieldOkResponseSchema } from './table/createField';
import { createRecordOkResponseSchema } from './table/createRecord';
import { createRecordsOkResponseSchema } from './table/createRecords';
import { createTableErrorResponseSchema, createTableOkResponseSchema } from './table/createTable';
import { createTablesOkResponseSchema } from './table/createTables';
import { deleteByRangeOkResponseSchema } from './table/deleteByRange';
import { deleteFieldOkResponseSchema } from './table/deleteField';
import { deleteRecordsOkResponseSchema } from './table/deleteRecords';
import { deleteTableErrorResponseSchema, deleteTableOkResponseSchema } from './table/deleteTable';
import { duplicateRecordOkResponseSchema } from './table/duplicateRecord';
import {
  explainCreateRecordInputSchema,
  explainDeleteRecordsInputSchema,
  explainOkResponseSchema,
  explainUpdateRecordInputSchema,
} from './table/explainCommand';
import { getRecordByIdOkResponseSchema } from './table/getRecordById';
import { getTableByIdOkResponseSchema } from './table/getTableById';
import { importCsvOkResponseSchema } from './table/importCsv';
import { importRecordsOkResponseSchema } from './table/importRecords';
import { listTableRecordsOkResponseSchema } from './table/listTableRecords';
import { listTablesOkResponseSchema } from './table/listTables';
import { pasteOkResponseSchema } from './table/paste';
import { renameTableOkResponseSchema } from './table/renameTable';
import { reorderRecordsOkResponseSchema } from './table/reorderRecords';
import { submitRecordOkResponseSchema } from './table/submitRecord';
import { updateRecordOkResponseSchema } from './table/updateRecord';

const BASES_CREATE_PATH = '/bases/create';
const BASES_LIST_PATH = '/bases/list';
const TABLES_CREATE_FIELD_PATH = '/tables/createField';
const TABLES_CREATE_PATH = '/tables/create';
const TABLES_CREATE_TABLES_PATH = '/tables/createTables';
const TABLES_CREATE_RECORD_PATH = '/tables/createRecord';
const TABLES_SUBMIT_RECORD_PATH = '/tables/submitRecord';
const TABLES_CREATE_RECORDS_PATH = '/tables/createRecords';
const TABLES_DELETE_RECORDS_PATH = '/tables/deleteRecords';
const TABLES_DELETE_FIELD_PATH = '/tables/deleteField';
const TABLES_DELETE_PATH = '/tables/delete';
const TABLES_EXPLAIN_CREATE_RECORD_PATH = '/tables/explainCreateRecord';
const TABLES_EXPLAIN_UPDATE_RECORD_PATH = '/tables/explainUpdateRecord';
const TABLES_EXPLAIN_DELETE_RECORDS_PATH = '/tables/explainDeleteRecords';
const TABLES_GET_PATH = '/tables/get';
const TABLES_GET_RECORD_PATH = '/tables/getRecord';
const TABLES_IMPORT_CSV_PATH = '/tables/importCsv';
const TABLES_IMPORT_RECORDS_PATH = '/tables/importRecords';
const TABLES_LIST_RECORDS_PATH = '/tables/listRecords';
const TABLES_LIST_PATH = '/tables/list';
const TABLES_PASTE_PATH = '/tables/paste';
const TABLES_CLEAR_PATH = '/tables/clear';
const TABLES_DELETE_BY_RANGE_PATH = '/tables/deleteByRange';
const TABLES_RENAME_PATH = '/tables/rename';
const TABLES_UPDATE_RECORD_PATH = '/tables/updateRecord';
const TABLES_REORDER_RECORDS_PATH = '/tables/reorderRecords';
const TABLES_DUPLICATE_RECORD_PATH = '/tables/duplicateRecord';

export const v2Contract: AnyContractRouter = {
  bases: {
    create: oc
      .route({
        method: 'POST',
        path: BASES_CREATE_PATH,
        successStatus: 201,
        summary: 'Create base',
        tags: ['bases'],
      })
      .input(createBaseInputSchema)
      .output(createBaseOkResponseSchema),
    list: oc
      .route({
        method: 'GET',
        path: BASES_LIST_PATH,
        successStatus: 200,
        summary: 'List bases',
        tags: ['bases'],
      })
      .input(listBasesInputSchema)
      .output(listBasesOkResponseSchema),
  },
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
    createTables: oc
      .route({
        method: 'POST',
        path: TABLES_CREATE_TABLES_PATH,
        successStatus: 201,
        summary: 'Create tables',
        tags: ['tables'],
      })
      .input(createTablesInputSchema)
      .output(createTablesOkResponseSchema),
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
    submitRecord: oc
      .route({
        method: 'POST',
        path: TABLES_SUBMIT_RECORD_PATH,
        successStatus: 201,
        summary: 'Submit record from form',
        tags: ['tables'],
      })
      .input(submitRecordInputSchema)
      .output(submitRecordOkResponseSchema),
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
    deleteRecords: oc
      .route({
        method: 'DELETE',
        path: TABLES_DELETE_RECORDS_PATH,
        successStatus: 200,
        summary: 'Delete records',
        tags: ['tables'],
      })
      .input(deleteRecordsInputSchema)
      .output(deleteRecordsOkResponseSchema),
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
    getRecord: oc
      .route({
        method: 'GET',
        path: TABLES_GET_RECORD_PATH,
        successStatus: 200,
        summary: 'Get record by id',
        tags: ['tables'],
      })
      .input(getRecordByIdInputSchema)
      .output(getRecordByIdOkResponseSchema),
    importCsv: oc
      .route({
        method: 'POST',
        path: TABLES_IMPORT_CSV_PATH,
        successStatus: 201,
        summary: 'Import CSV to create table with records',
        tags: ['tables'],
      })
      .input(importCsvInputSchema)
      .output(importCsvOkResponseSchema),
    importRecords: oc
      .route({
        method: 'POST',
        path: TABLES_IMPORT_RECORDS_PATH,
        successStatus: 200,
        summary: 'Import records into existing table',
        tags: ['tables'],
      })
      .input(importRecordsInputSchema)
      .output(importRecordsOkResponseSchema),
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
    updateRecord: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_RECORD_PATH,
        successStatus: 200,
        summary: 'Update record',
        tags: ['tables'],
      })
      .input(updateRecordInputSchema)
      .output(updateRecordOkResponseSchema),
    reorderRecords: oc
      .route({
        method: 'POST',
        path: TABLES_REORDER_RECORDS_PATH,
        successStatus: 200,
        summary: 'Reorder records',
        tags: ['tables'],
      })
      .input(reorderRecordsInputSchema)
      .output(reorderRecordsOkResponseSchema),
    duplicateRecord: oc
      .route({
        method: 'POST',
        path: TABLES_DUPLICATE_RECORD_PATH,
        successStatus: 201,
        summary: 'Duplicate record',
        tags: ['tables'],
      })
      .input(duplicateRecordInputSchema)
      .output(duplicateRecordOkResponseSchema),
    paste: oc
      .route({
        method: 'POST',
        path: TABLES_PASTE_PATH,
        successStatus: 200,
        summary: 'Paste content to table cells',
        tags: ['tables'],
      })
      .input(pasteCommandInputSchema)
      .output(pasteOkResponseSchema),
    clear: oc
      .route({
        method: 'POST',
        path: TABLES_CLEAR_PATH,
        successStatus: 200,
        summary: 'Clear cell values in selected range',
        tags: ['tables'],
      })
      .input(clearCommandInputSchema)
      .output(clearOkResponseSchema),
    deleteByRange: oc
      .route({
        method: 'DELETE',
        path: TABLES_DELETE_BY_RANGE_PATH,
        successStatus: 200,
        summary: 'Delete records by range selection',
        tags: ['tables'],
      })
      .input(deleteByRangeCommandInputSchema)
      .output(deleteByRangeOkResponseSchema),
    explainCreateRecord: oc
      .route({
        method: 'POST',
        path: TABLES_EXPLAIN_CREATE_RECORD_PATH,
        successStatus: 200,
        summary: 'Explain create record command',
        tags: ['tables', 'explain'],
      })
      .input(explainCreateRecordInputSchema)
      .output(explainOkResponseSchema),
    explainUpdateRecord: oc
      .route({
        method: 'POST',
        path: TABLES_EXPLAIN_UPDATE_RECORD_PATH,
        successStatus: 200,
        summary: 'Explain update record command',
        tags: ['tables', 'explain'],
      })
      .input(explainUpdateRecordInputSchema)
      .output(explainOkResponseSchema),
    explainDeleteRecords: oc
      .route({
        method: 'POST',
        path: TABLES_EXPLAIN_DELETE_RECORDS_PATH,
        successStatus: 200,
        summary: 'Explain delete records command',
        tags: ['tables', 'explain'],
      })
      .input(explainDeleteRecordsInputSchema)
      .output(explainOkResponseSchema),
  },
} as const satisfies AnyContractRouter;

export const v2ContractErrors = {
  400: createTableErrorResponseSchema,
  404: deleteTableErrorResponseSchema,
  500: createTableErrorResponseSchema,
} as const;
