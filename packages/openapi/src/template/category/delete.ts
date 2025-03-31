import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const DELETE_TEMPLATE_CATEGORY = '/template/category/{templateCategoryId}';

export const DeleteTemplateCategoryRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_TEMPLATE_CATEGORY,
  description: 'delete a template category',
  request: {
    params: z.object({
      templateCategoryId: z.string().startsWith(IdPrefix.TemplateCategory),
    }),
  },
  responses: {
    201: {
      description: 'Successfully delete template category.',
    },
  },
  tags: ['template'],
});

export const deleteTemplateCategory = async (templateCategoryId: string) => {
  return axios.delete<void>(urlBuilder(DELETE_TEMPLATE_CATEGORY, { templateCategoryId }));
};
