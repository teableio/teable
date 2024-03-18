import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IUpdateOrderRo } from './update-order';
import { updateOrderRoSchema } from './update-order';

export const RECORD_ORDER = '/table/{tableId}/view/{viewId}/{recordId}/order';

export const updateViewOrderRoute: RouteConfig = registerRoute({
  method: 'put',
  path: RECORD_ORDER,
  description: 'Update record order in view',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
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

export const updateViewOrder = async (
  tableId: string,
  viewId: string,
  recordId: string,
  orderRo: IUpdateOrderRo
) => {
  return axios.put<void>(
    urlBuilder(RECORD_ORDER, {
      tableId,
      viewId,
      recordId,
    }),
    orderRo
  );
};
