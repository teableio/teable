import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IGetTableQuery, ITableVo } from '@teable/core';
import { getTableQuerySchema, tableVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_TABLE = '/base/{baseId}/table/{tableId}';

export const GetTableRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TABLE,
  description: 'Get a table',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    query: getTableQuerySchema,
  },
  responses: {
    200: {
      description: 'Returns data about a table.',
      content: {
        'application/json': {
          schema: tableVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const getTableById = async (baseId: string, tableId: string, query: IGetTableQuery) => {
  return axios.get<ITableVo>(
    urlBuilder(GET_TABLE, {
      baseId,
      tableId,
    }),
    {
      params: query,
    }
  );
};
