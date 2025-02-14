import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IViewVo } from '@teable/core';
import { viewVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_VIEW_LIST = '/table/{tableId}/view';

export const GetViewListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_VIEW_LIST,
  summary: 'Get view list',
  description: 'Get view list',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the list of view.',
      content: {
        'application/json': {
          schema: z.array(viewVoSchema),
        },
      },
    },
  },
  tags: ['view'],
});

export const getViewList = async (tableId: string) => {
  return axios.get<IViewVo[]>(urlBuilder(GET_VIEW_LIST, { tableId }));
};
