import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IViewAggregationRo, IViewAggregationVo } from '@teable-group/core';
import { viewAggregationRoSchema, viewVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_VIEW_AGGREGATIONS_LIST = '/table/{tableId}/aggregation/{viewId}';

export const GetViewAggregationsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_VIEW_AGGREGATIONS_LIST,
  description: 'Get view aggregations by query',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    query: viewAggregationRoSchema,
  },
  responses: {
    200: {
      description: 'Returns aggregations list of view.',
      content: {
        'application/json': {
          schema: z.array(viewVoSchema),
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getViewAggregations = async (
  tableId: string,
  viewId: string,
  query?: IViewAggregationRo
) => {
  return axios.get<IViewAggregationVo>(
    urlBuilder(GET_VIEW_AGGREGATIONS_LIST, { tableId, viewId }),
    {
      params: query,
    }
  );
};
