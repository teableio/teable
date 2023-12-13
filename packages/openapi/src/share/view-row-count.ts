import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IRowCountRo, IRowCountVo } from '@teable-group/core';
import { rowCountVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { paramsSerializer, registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

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
          schema: rowCountVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const getShareViewRowCount = async (shareId: string, query?: IRowCountRo) => {
  return axios.get<IRowCountVo>(urlBuilder(SHARE_VIEW_ROW_COUNT, { shareId }), {
    params: query,
    paramsSerializer,
  });
};
