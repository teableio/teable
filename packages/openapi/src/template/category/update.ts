import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const UPDATE_TEMPLATE_CATEGORY = '/template/category/{templateCategoryId}';

export const updateTemplateCategoryRoSchema = z.object({
  name: z.string(),
});

export type IUpdateTemplateCategoryRo = z.infer<typeof updateTemplateCategoryRoSchema>;

export const UpdateTemplateCategoryRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_TEMPLATE_CATEGORY,
  description: 'update a template category name',
  request: {
    params: z.object({
      templateCategoryId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateTemplateCategoryRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully update template category name.',
    },
  },
  tags: ['template'],
});

export const updateTemplateCategory = async (
  templateCategoryId: string,
  updateTemplateCategoryRoSchema: IUpdateTemplateCategoryRo
) => {
  return axios.patch<void>(
    urlBuilder(UPDATE_TEMPLATE_CATEGORY, { templateCategoryId }),
    updateTemplateCategoryRoSchema
  );
};
