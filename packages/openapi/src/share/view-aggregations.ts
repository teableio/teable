import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IAggregationVo } from '@teable-group/core';
import { aggregationRoSchema, viewVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { paramsSerializer, registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_AGGREGATIONS_LIST = '/share/{shareId}/view/aggregations';

export const shareViewAggregationsRoSchema = aggregationRoSchema.pick({ filter: true });

export type IShareViewAggregationsRo = z.infer<typeof shareViewAggregationsRoSchema>;

export const ShareViewAggregationsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_AGGREGATIONS_LIST,
  description: 'Get share view aggregations',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: z.object({}),
  },
  responses: {
    200: {
      description: 'Returns aggregations list of share view.',
      content: {
        'application/json': {
          schema: z.array(viewVoSchema),
        },
      },
    },
  },
  tags: ['share'],
});

export const getShareViewAggregations = async (
  shareId: string,
  query?: IShareViewAggregationsRo
) => {
  return axios.get<IAggregationVo>(urlBuilder(SHARE_VIEW_AGGREGATIONS_LIST, { shareId }), {
    params: query,
    paramsSerializer,
  });
};
