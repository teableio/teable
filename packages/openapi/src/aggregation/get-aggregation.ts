import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IAggregationRo, IAggregationVo } from '@teable-group/core';
import { aggregationRoSchema, aggregationVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_AGGREGATION_LIST = '/table/{tableId}/aggregation';

export const GetAggregationRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_AGGREGATION_LIST,
  description: 'Get aggregations by query',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: z.object({}),
  },
  responses: {
    200: {
      description: 'Returns aggregations list.',
      content: {
        'application/json': {
          schema: z.array(aggregationVoSchema),
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getAggregation = async (tableId: string, query?: IAggregationRo) => {
  return axios.get<IAggregationVo>(urlBuilder(GET_AGGREGATION_LIST, { tableId }), {
    params: query,
  });
};
