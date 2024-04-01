import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IQueryBaseRo, IRowCountVo } from '@teable/core';
import { queryBaseSchema, rowCountVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_ROW_COUNT = '/table/{tableId}/aggregation/row-count';

export const GetRowCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_ROW_COUNT,
  description: 'Get row count for the view',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: queryBaseSchema,
  },
  responses: {
    200: {
      description: 'Row count for the view',
      content: {
        'application/json': {
          schema: rowCountVoSchema,
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getRowCount = async (tableId: string, query?: IQueryBaseRo) => {
  return axios.get<IRowCountVo>(urlBuilder(GET_ROW_COUNT, { tableId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
    },
  });
};
