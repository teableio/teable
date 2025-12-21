import { oc } from '@orpc/contract';
import { createTableInputSchema, getTableByIdInputSchema } from '@teable/v2-core';

import { createTableErrorResponseSchema, createTableOkResponseSchema } from './table/createTable';
import {
  getTableByIdErrorResponseSchema,
  getTableByIdOkResponseSchema,
} from './table/getTableById';

const TABLES_CREATE_PATH = '/tables/create';
const TABLES_GET_PATH = '/tables/get';

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
  },
} as const;

export const v2ContractErrors = {
  400: createTableErrorResponseSchema,
  404: getTableByIdErrorResponseSchema,
  500: createTableErrorResponseSchema,
} as const;
