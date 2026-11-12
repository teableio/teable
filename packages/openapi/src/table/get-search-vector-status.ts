import type { RouteConfig } from '@asteasolutions/zod-to-openapi';

import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_TABLE_SEARCH_VECTOR_STATUS = '/base/{baseId}/table/{tableId}/search-vector-status';

export const tableSearchVectorStatusSchema = z.object({
  tableId: z.string(),
  state: z.enum(['disabled', 'ready', 'rebuild_pending', 'stale', 'unknown']),
  configured: z.boolean(),
  /** A published, usable snapshot is bound to this physical table, so reads can be served by it. */
  serving: z.boolean(),
  active: z.boolean(),
  languageConfig: z.string().optional(),
  coveredFieldIds: z.array(z.string()),
  searchScope: z.enum(['all_fields', 'selected_fields']).optional(),
  /**
   * Searchable fields the published coverage does not include. Only present while `serving` and
   * only for an `all_fields` document; absent means "not applicable", not "fully covered".
   */
  uncoveredFieldIds: z.array(z.string()).optional(),
  coveredFieldCount: z.number().int().nonnegative(),
});

export type ITableSearchVectorStatusVo = z.infer<typeof tableSearchVectorStatusSchema>;

export const GetTableSearchVectorStatusRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TABLE_SEARCH_VECTOR_STATUS,
  summary: 'Get table search vector status',
  description: 'Returns the read-only generated full-text search status for a table',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: tableSearchVectorStatusSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const getTableSearchVectorStatus = (baseId: string, tableId: string) =>
  axios.get<ITableSearchVectorStatusVo>(
    urlBuilder(GET_TABLE_SEARCH_VECTOR_STATUS, { baseId, tableId })
  );
