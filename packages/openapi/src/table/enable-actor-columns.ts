import type { RouteConfig } from '@asteasolutions/zod-to-openapi';

import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { ITableActorColumnsVo } from './get-actor-columns';
import { tableActorColumnsVoSchema } from './get-actor-columns';

export const ENABLE_TABLE_ACTOR_COLUMNS = '/base/{baseId}/table/{tableId}/actor-columns/enable';

export const enableTableActorColumnsRoSchema = z.object({}).strict().meta({
  description:
    'No options. Enabling actor storage is idempotent per table and target version; repeating the call retries a failed operation under the same key.',
});

export type IEnableTableActorColumnsRo = z.infer<typeof enableTableActorColumnsRoSchema>;

export const EnableTableActorColumnsRoute: RouteConfig = registerRoute({
  method: 'post',
  path: ENABLE_TABLE_ACTOR_COLUMNS,
  summary: 'Enable table actor columns',
  description:
    'Enqueues the one-time physical actor column enable for a table. 200 means the enqueue was accepted or the table is already ready; it does not mean the DDL finished. Poll the GET endpoint. The same call retries a failed operation.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: enableTableActorColumnsRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Actor column enable accepted',
      content: {
        'application/json': {
          schema: tableActorColumnsVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const enableTableActorColumns = async (
  baseId: string,
  tableId: string,
  ro: IEnableTableActorColumnsRo = {}
) => {
  return axios.post<ITableActorColumnsVo>(
    urlBuilder(ENABLE_TABLE_ACTOR_COLUMNS, { baseId, tableId }),
    ro
  );
};
