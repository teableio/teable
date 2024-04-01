import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import type { IUpdateOrderRo } from '../view/update-order';
import { updateOrderRoSchema } from '../view/update-order';
import { z } from '../zod';

export const TABLE_ORDER = '/base/{baseId}/table/{tableId}/order';

export const updateTableOrderRoute: RouteConfig = registerRoute({
  method: 'put',
  path: TABLE_ORDER,
  description: 'Update table order',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
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
  tags: ['table'],
});

export const updateTableOrder = async (
  baseId: string,
  tableId: string,
  orderRo: IUpdateOrderRo
) => {
  return axios.put<void>(
    urlBuilder(TABLE_ORDER, {
      baseId,
      tableId,
    }),
    orderRo
  );
};
