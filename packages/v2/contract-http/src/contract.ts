import { oc } from '@orpc/contract';
import { createTableInputSchema } from '@teable/v2-core';

import { createTableErrorResponseSchema, createTableOkResponseSchema } from './table/createTable';

export const v2Contract = {
  tables: {
    create: oc
      .route({
        method: 'POST',
        path: '/tables',
        successStatus: 201,
        summary: 'Create table',
        tags: ['tables'],
      })
      .input(createTableInputSchema)
      .output(createTableOkResponseSchema),
  },
} as const;

export const v2ContractErrors = {
  400: createTableErrorResponseSchema,
  500: createTableErrorResponseSchema,
} as const;
