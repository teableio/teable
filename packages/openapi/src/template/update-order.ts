import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import type { IUpdateOrderRo } from '../view/update-order';
import { updateOrderRoSchema } from '../view/update-order';
import { z } from '../zod';

export const TEMPLATE_ORDER = '/template/{templateId}/order';

export const updateTemplateOrderRoute: RouteConfig = registerRoute({
  method: 'put',
  path: TEMPLATE_ORDER,
  description: 'Update template order',
  request: {
    params: z.object({
      templateId: z.string(),
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
  tags: ['template'],
});

export const updateTemplateOrder = async (params: { templateId: string } & IUpdateOrderRo) => {
  const { templateId, ...orderRo } = params;
  return axios.put<void>(
    urlBuilder(TEMPLATE_ORDER, {
      templateId,
    }),
    orderRo
  );
};
