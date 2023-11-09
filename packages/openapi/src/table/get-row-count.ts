import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IViewRowCountVo, IGetRowCountRo } from '@teable-group/core';
import { getRowCountSchema, viewRowCountSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_ROW_COUNT = '/base/{baseId}/table/{tableId}/rowCount';

export const GetRowCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_ROW_COUNT,
  description: 'Get row count for the table',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    query: getRowCountSchema,
  },
  responses: {
    200: {
      description: 'Row count for the table',
      content: {
        'application/json': {
          schema: viewRowCountSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const getRowCount = async (baseId: string, tableId: string, query?: IGetRowCountRo) => {
  return axios.get<IViewRowCountVo>(urlBuilder(GET_ROW_COUNT, { baseId, tableId }), {
    params: query,
  });
};
