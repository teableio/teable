import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { ITableIndexType } from './toggle-table-index';
import { tableIndexTypeSchema } from './toggle-table-index';

export const TABLE_ACTIVATED_INDEX = '/base/{baseId}/table/{tableId}/activated-index';

export const TableActivatedIndexRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TABLE_ACTIVATED_INDEX,
  summary: 'Get activated index',
  description: 'Get the activated index of a table',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Returns table full text search index status',
      content: {
        'application/json': {
          schema: tableIndexTypeSchema.array(),
        },
      },
    },
  },
  tags: ['table'],
});

export const getTableActivatedIndex = (baseId: string, tableId: string) => {
  return axios.get<ITableIndexType[]>(urlBuilder(TABLE_ACTIVATED_INDEX, { baseId, tableId }));
};
