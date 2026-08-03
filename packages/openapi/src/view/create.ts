import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IViewRo, IViewVo } from '@teable/core';
import { viewRoSchema, viewVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const CREATE_VIEW = '/table/{tableId}/view';

export const CreateViewRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_VIEW,
  description: 'Create a view',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: viewRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
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

export const createView = async (tableId: string, viewRo: IViewRo) => {
  return axios.post<IViewVo>(urlBuilder(CREATE_VIEW, { tableId }), viewRo);
};
