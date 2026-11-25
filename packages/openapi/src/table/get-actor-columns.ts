import type { RouteConfig } from '@asteasolutions/zod-to-openapi';

import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_TABLE_ACTOR_COLUMNS = '/base/{baseId}/table/{tableId}/actor-columns';

export const tableActorColumnsStateSchema = z.enum(['disabled', 'pending', 'error', 'ready']);

export const tableActorColumnsOperationSchema = z.object({
  id: z.string().meta({
    description: 'The persisted schema operation id that tracks this table actor column enable.',
  }),
  status: z.enum(['pending', 'running', 'ready', 'error', 'dead']),
  phase: z.string(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().nonnegative(),
  lastError: z.string().nullable().meta({
    description: 'Safe allowlisted error summary. It never contains raw SQL, DSNs or secrets.',
  }),
  nextRunAt: z.string(),
});

export type ITableActorColumnsOperationVo = z.infer<typeof tableActorColumnsOperationSchema>;

export const tableActorColumnsVoSchema = z.object({
  tableId: z.string(),
  actorStorageVersion: z.union([z.literal(0), z.literal(1)]),
  state: tableActorColumnsStateSchema.meta({
    description:
      'disabled: version 0 and no operation; pending: version 0 with a pending/running operation; error: version 0 with a failed/dead operation; ready: version 1.',
  }),
  operation: tableActorColumnsOperationSchema.optional(),
});

export type ITableActorColumnsVo = z.infer<typeof tableActorColumnsVoSchema>;

export const GetTableActorColumnsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TABLE_ACTOR_COLUMNS,
  summary: 'Get table actor columns status',
  description:
    'Returns the read-only row-level actor attribution status for a table. A disabled table returns 200 with state disabled; it is never hidden or 404.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Table actor columns status',
      content: {
        'application/json': {
          schema: tableActorColumnsVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const getTableActorColumns = async (baseId: string, tableId: string) => {
  return axios.get<ITableActorColumnsVo>(urlBuilder(GET_TABLE_ACTOR_COLUMNS, { baseId, tableId }));
};
