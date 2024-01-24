import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const TABLE_ORDER = '/base/{baseId}/table/{tableId}/order';

export const tableOrderRoSchema = z.object({
  order: z.number(),
});

export type ITableOrderRo = z.infer<typeof tableOrderRoSchema>;

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
          schema: tableOrderRoSchema,
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

export const updateTableOrder = async (baseId: string, tableId: string, data: ITableOrderRo) => {
  return axios.put<void>(
    urlBuilder(TABLE_ORDER, {
      baseId,
      tableId,
    }),
    data
  );
};
