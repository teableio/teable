import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { ITableVo } from './create';
import { tableVoSchema } from './create';
export const GET_TABLE = '/base/{baseId}/table/{tableId}';

export const GetTableRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TABLE,
  summary: 'Get table details',
  description:
    'Retrieve detailed information about a specific table, including its schema, name, and configuration.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
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

export const getTableById = async (baseId: string, tableId: string) => {
  return axios.get<ITableVo>(
    urlBuilder(GET_TABLE, {
      baseId,
      tableId,
    })
  );
};
