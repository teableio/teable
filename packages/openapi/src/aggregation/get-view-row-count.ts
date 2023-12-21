import type { IViewRowCountRo, IViewRowCountVo } from '@teable-group/core';
import { viewRowCountSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const GET_VIEW_ROW_COUNT = '/table/{tableId}/aggregation/{viewId}/rowCount';

export const GetViewRowCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_VIEW_ROW_COUNT,
  description: 'Get row count for the view',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    query: z.object({}),
  },
  responses: {
    200: {
      description: 'Row count for the view',
      content: {
        'application/json': {
          schema: viewRowCountSchema,
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getViewRowCount = async (tableId: string, viewId: string, query?: IViewRowCountRo) => {
  return axios.get<IViewRowCountVo>(
    urlBuilder(GET_VIEW_ROW_COUNT, {
      tableId,
      viewId,
    }),
    {
      params: query,
    }
  );
};
