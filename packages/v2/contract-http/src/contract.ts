import { oc } from '@orpc/contract';
import {
  createTableInputSchema,
  deleteTableInputSchema,
  getTableByIdInputSchema,
  listTablesInputSchema,
  renameTableInputSchema,
} from '@teable/v2-core';

import { createTableErrorResponseSchema, createTableOkResponseSchema } from './table/createTable';
import { deleteTableErrorResponseSchema, deleteTableOkResponseSchema } from './table/deleteTable';
import { getTableByIdOkResponseSchema } from './table/getTableById';
import { listTablesOkResponseSchema } from './table/listTables';
import { renameTableOkResponseSchema } from './table/renameTable';

const TABLES_CREATE_PATH = '/tables/create';
const TABLES_DELETE_PATH = '/tables/delete';
const TABLES_GET_PATH = '/tables/get';
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
