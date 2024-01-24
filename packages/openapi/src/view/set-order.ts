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

export const SetViewOrderRoute: RouteConfig = registerRoute({
  method: 'patch',
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

export const setViewOrder = async (tableId: string, viewId: string, orderRo: IViewOrderRo) => {
  return axios.patch<void>(
    urlBuilder(VIEW_ORDER, {
      tableId,
      viewId,
    }),
    orderRo
  );
};
