import type { IViewRo, IViewVo } from '@teable-group/core';
import { viewRoSchema, viewVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const CREATE_VIEW = '/table/{tableId}/view';

export const CreateViewRoute: RouteConfig = registerRoute({
  method: 'POST',
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
