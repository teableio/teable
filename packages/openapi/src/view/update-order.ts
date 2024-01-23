import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_ORDER = '/table/{tableId}/view/{viewId}/order';

export interface IViewOrderRo {
  order: number;
}

export const viewOrderRoSchema = z.object({
  order: z.number(),
});

export const updateViewOrderRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_ORDER,
  description: 'Update view order',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: viewOrderRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update.',
    },
  },
  tags: ['view'],
});

export const updateViewOrder = async (tableId: string, viewId: string, orderRo: IViewOrderRo) => {
  return axios.put<void>(
    urlBuilder(VIEW_ORDER, {
      tableId,
      viewId,
    }),
    orderRo
  );
};
