import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const updateRecordOrdersRoSchema = z.object({
  anchorId: z.string().openapi({
    description: 'Id of the record that you want to move other records around',
  }),
  position: z.enum(['before', 'after']),
  recordIds: z.string().array().max(1000).openapi({
    description: 'Ids of those records you want to move',
    maxLength: 1000,
  }),
});

export type IUpdateRecordOrdersRo = z.infer<typeof updateRecordOrdersRoSchema>;

export const RECORD_ORDER = '/table/{tableId}/view/{viewId}/record-order';

export const updateRecordOrdersRoute: RouteConfig = registerRoute({
  method: 'put',
  path: RECORD_ORDER,
  description: 'Update record order in view',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateRecordOrdersRoSchema,
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

export const updateRecordOrders = async (
  tableId: string,
  viewId: string,
  orderRo: IUpdateRecordOrdersRo
) => {
  return axios.put<void>(
    urlBuilder(RECORD_ORDER, {
      tableId,
      viewId,
    }),
    orderRo
  );
};
