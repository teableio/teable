import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import type { IUpdateOrderRo } from '../../view/update-order';
import { updateOrderRoSchema } from '../../view/update-order';
import { z } from '../../zod';

export const TEMPLATE_CATEGORY_ORDER = '/template/category/{templateCategoryId}/order';

export const updateTemplateCategoryOrderRoute: RouteConfig = registerRoute({
  method: 'put',
  path: TEMPLATE_CATEGORY_ORDER,
  description: 'Update template category order',
  request: {
    params: z.object({
      templateCategoryId: z.string(),
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

export const updateTemplateCategoryOrder = async (
  params: { templateCategoryId: string } & IUpdateOrderRo
) => {
  const { templateCategoryId, ...orderRo } = params;
  return axios.put<void>(
    urlBuilder(TEMPLATE_CATEGORY_ORDER, {
      templateCategoryId,
    }),
    orderRo
  );
};
