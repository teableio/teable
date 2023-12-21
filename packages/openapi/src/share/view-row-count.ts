import type { IViewRowCountRo, IViewRowCountVo } from '@teable-group/core';
import { viewRowCountSchema } from '@teable-group/core';
import { axios } from '../axios';
import { paramsSerializer, registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const SHARE_VIEW_ROW_COUNT = '/share/{shareId}/view/rowCount';

export const ShareViewRowCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_ROW_COUNT,
  description: 'Get row count for the share view',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: z.object({}),
  },
  responses: {
    200: {
      description: 'Row count for the share view',
      content: {
        'application/json': {
          schema: viewRowCountSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const getShareViewRowCount = async (shareId: string, query?: IViewRowCountRo) => {
  return axios.get<IViewRowCountVo>(urlBuilder(SHARE_VIEW_ROW_COUNT, { shareId }), {
    params: query,
    paramsSerializer,
  });
};
