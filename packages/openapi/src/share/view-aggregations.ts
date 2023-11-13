import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IViewAggregationVo } from '@teable-group/core';
import { viewVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_AGGREGATIONS_LIST = '/share/{shareId}/view/aggregation';

export const ShareViewAggregationsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_AGGREGATIONS_LIST,
  description: 'Get share view aggregations',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
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

export const getShareViewAggregations = async (shareId: string) => {
  return axios.get<IViewAggregationVo>(urlBuilder(SHARE_VIEW_AGGREGATIONS_LIST, { shareId }));
};
