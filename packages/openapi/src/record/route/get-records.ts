import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { GET_RECORDS_URL } from '../path';
import { recordsQuerySchema, recordsVoSchema } from '../schema.def';

export const GetRecordsRoute: RouteConfig = {
  method: 'get',
  path: GET_RECORDS_URL,
  description: 'list of records',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: recordsQuerySchema,
  },
  responses: {
    200: {
      description: 'list of records',
      content: {
        'application/json': {
          schema: recordsVoSchema,
        },
      },
    },
  },
  tags: ['record'],
};
