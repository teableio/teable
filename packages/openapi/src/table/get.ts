import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IGetTableQuery, ITableVo } from '@teable-group/core';
import { getTableQuerySchema, tableVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

export const GET_TABLE = '/base/{baseId}/table/{tableId}';

export const GetTableRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TABLE,
  description: 'Get a table',
  request: {
    params: getTableQuerySchema,
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

export const getTableById = async (baseId: string, tableId: string, params: IGetTableQuery) => {
  return axios.get<ITableVo>(
    urlBuilder(GET_TABLE, {
      query: { baseId, tableId },
      params,
    })
  );
};
