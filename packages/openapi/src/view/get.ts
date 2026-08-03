import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IViewVo } from '@teable/core';
import { viewVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_VIEW = '/table/{tableId}/view/{viewId}';

export const GetViewRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_VIEW,
  description: 'Get a view',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about a view.',
      content: {
        'application/json': {
          schema: viewVoSchema,
        },
      },
    },
  },
  tags: ['view'],
});

export const getView = async (tableId: string, viewId: string) => {
  return axios.get<IViewVo>(
    urlBuilder(GET_VIEW, {
      tableId,
      viewId,
    })
  );
};
