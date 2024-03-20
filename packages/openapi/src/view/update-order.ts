import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_ORDER = '/table/{tableId}/view/{viewId}/order';

export const updateOrderRoSchema = z.object({
  anchorId: z.string(),
  position: z.enum(['before', 'after']),
});

export type IUpdateOrderRo = z.infer<typeof updateOrderRoSchema>;

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
          schema: updateOrderRoSchema,
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

export const updateViewOrder = async (tableId: string, viewId: string, orderRo: IUpdateOrderRo) => {
  return axios.put<void>(
    urlBuilder(VIEW_ORDER, {
      tableId,
      viewId,
    }),
    orderRo
  );
};
