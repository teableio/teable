import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IViewVo } from '@teable/core';
import { viewRoSchema, viewVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DUPLICATE_VIEW = '/table/{tableId}/view/{viewId}/duplicate';

export const DuplicateViewRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DUPLICATE_VIEW,
  description: 'Duplicate a view',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
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

export const duplicateView = async (tableId: string, viewId: string) => {
  return axios.post<IViewVo>(urlBuilder(DUPLICATE_VIEW, { tableId, viewId }));
};
